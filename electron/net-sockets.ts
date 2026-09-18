// net-sockets.ts — native UDP/TCP MAVLink sockets for the desktop app.
// SPDX-License-Identifier: GPL-3.0-only
//
// A browser sandbox cannot open a raw UDP/TCP socket, so the renderer asks the
// main process (over IPC) to own the socket and relays bytes through it. This is
// the classic GCS UDP/TCP link. Inbound bytes are pushed to the renderer on
// `net:data`; socket close/error is pushed on `net:close`. Sockets are loopback/
// LAN endpoints the operator chose in the connect dialog and are never exposed
// beyond this typed IPC surface.

import { ipcMain, type BrowserWindow } from "electron";
import dgram from "node:dgram";
import net from "node:net";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";

/**
 * Upper bound on concurrently open sockets.
 *
 * `handles` had no cap, so a renderer loop calling `net:open` exhausted the
 * MAIN process's file descriptors — which takes the whole app down, not just
 * the tab.
 */
const MAX_HANDLES = 32;

/** TCP connect deadline. Without one an unreachable host hung the connect
 *  dialog for the OS SYN timeout (~75 s) with no cancel. */
const TCP_CONNECT_TIMEOUT_MS = 8000;

/**
 * Whether `host` is a loopback / private / link-local endpoint.
 *
 * `net:open` is the ENTIRE renderer-to-main attack surface, and it passed
 * `spec.host` and `spec.port` verbatim to `net.createConnection` /
 * `dgram.bind` with nothing checked at runtime. This file's own header
 * already stated the intended invariant — loopback/LAN endpoints only — and
 * nothing enforced it, so any HTML-injection sink in the app became LAN
 * port-scanning and raw-socket access from the flight-line machine.
 */
function isLocalEndpoint(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === "" || h === "0.0.0.0" || h === "::" || h === "localhost") return true;
  if (h.endsWith(".local")) return true;
  const family = isIP(h);
  if (family === 6) {
    // Loopback, unique-local (fc00::/7) and link-local (fe80::/10).
    return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8");
  }
  if (family !== 4) return false;
  const [a, b] = h.split(".").map(Number);
  if (a === 127) return true;                       // loopback
  if (a === 10) return true;                        // 10/8
  if (a === 192 && b === 168) return true;          // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 169 && b === 254) return true;          // link-local
  return false;
}

/** Reject a spec the renderer should never have been able to send. */
function validateSpec(spec: unknown): OpenSpec {
  if (!spec || typeof spec !== "object") throw new Error("net:open: bad spec");
  const s = spec as Record<string, unknown>;
  if (s.proto !== "udp" && s.proto !== "tcp") {
    throw new Error("net:open: proto must be udp or tcp");
  }
  if (s.mode !== undefined && s.mode !== "listen" && s.mode !== "target") {
    throw new Error("net:open: mode must be listen or target");
  }
  if (typeof s.host !== "string") throw new Error("net:open: host must be a string");
  if (
    typeof s.port !== "number" ||
    !Number.isInteger(s.port) ||
    s.port < 1 ||
    s.port > 65535
  ) {
    throw new Error("net:open: port must be an integer 1-65535");
  }
  if (!isLocalEndpoint(s.host)) {
    throw new Error(`net:open: refusing a non-local endpoint: ${s.host}`);
  }
  return { proto: s.proto, host: s.host, port: s.port, mode: s.mode };
}

interface OpenSpec {
  proto: "udp" | "tcp";
  host: string;
  port: number;
  mode?: "listen" | "target";
}

interface UdpHandle {
  proto: "udp";
  socket: dgram.Socket;
  /** Where to send GCS→drone bytes: learned from the first datagram (listen)
   *  or the fixed target (target mode). */
  peer: { host: string; port: number } | null;
}
interface TcpHandle {
  proto: "tcp";
  socket: net.Socket;
}
type Handle = UdpHandle | TcpHandle;

let mainWindow: BrowserWindow | null = null;
const handles = new Map<string, Handle>();

function pushToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function openSocket(rawSpec: unknown): Promise<{ id: string }> {
  const spec = validateSpec(rawSpec);
  if (handles.size >= MAX_HANDLES) {
    return Promise.reject(new Error(`net:open: too many open sockets (${MAX_HANDLES})`));
  }
  const id = randomUUID();

  if (spec.proto === "udp") {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      const handle: UdpHandle = {
        proto: "udp",
        socket,
        peer:
          spec.mode === "target" ? { host: spec.host, port: spec.port } : null,
      };

      let settled = false;

      socket.on("message", (msg, rinfo) => {
        // Learn the peer ONCE, from the first datagram in listen mode (the
        // autopilot sends to us, e.g. `--out=udp:GCS:14550`); keep the fixed
        // target otherwise.
        //
        // The guard used to be `handle.peer === null || spec.mode !== "target"`,
        // whose second clause is ALWAYS true in listen mode — so the peer was
        // overwritten by the source address of the most recent datagram, and
        // the shipped default is `{host:"0.0.0.0", port:14550, mode:"listen"}`,
        // which binds every interface. One spoofed datagram from anywhere on
        // the operator's network silently redirected every subsequent
        // GCS→vehicle byte: arm/disarm, mode change, RTL and mission upload
        // stopped reaching the aircraft while the link still read healthy,
        // because real telemetry kept flipping the peer back.
        if (handle.peer === null) {
          handle.peer = { host: rinfo.address, port: rinfo.port };
        }
        // Datagrams from outside the local endpoint space are dropped rather
        // than relayed into the MAVLink parser.
        if (!isLocalEndpoint(rinfo.address)) return;
        pushToRenderer("net:data", { id, data: msg });
      });

      socket.on("error", (err) => {
        if (!settled) {
          settled = true;
          handles.delete(id);
          try {
            socket.close();
          } catch {
            /* ignore */
          }
          reject(err);
          return;
        }
        pushToRenderer("net:close", { id, reason: err.message });
        closeSocket(id);
      });

      if (spec.mode === "target") {
        // No bind needed — the OS assigns an ephemeral source port on first
        // send and replies arrive on it. Ready immediately.
        handles.set(id, handle);
        settled = true;
        resolve({ id });
      } else {
        socket.on("listening", () => {
          settled = true;
          handles.set(id, handle);
          resolve({ id });
        });
        // Bind to all interfaces when host is unspecified / wildcard.
        const bindHost =
          spec.host && spec.host !== "0.0.0.0" ? spec.host : undefined;
        socket.bind(spec.port, bindHost);
      }
    });
  }

  // TCP — connect as a client (the SITL / mavlink-router server case).
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host: spec.host, port: spec.port });
    // TCP is the SITL / mavlink-router command path, so Nagle would hold a
    // small outbound MAVLink command for ~40 ms behind the ack.
    socket.setNoDelay(true);
    socket.setTimeout(TCP_CONNECT_TIMEOUT_MS, () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`net:open: TCP connect to ${spec.host}:${spec.port} timed out`));
      }
    });
    socket.on("connect", () => {
      settled = true;
      // The deadline covered the CONNECT only; an idle established link is
      // normal on a low-rate telemetry stream.
      socket.setTimeout(0);
      handles.set(id, { proto: "tcp", socket });
      resolve({ id });
    });
    socket.on("data", (data: Buffer) => {
      pushToRenderer("net:data", { id, data });
    });
    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
        return;
      }
      pushToRenderer("net:close", { id, reason: err.message });
      closeSocket(id);
    });
    socket.on("close", () => {
      if (handles.has(id)) {
        pushToRenderer("net:close", { id });
        closeSocket(id);
      }
    });
  });
}

function sendSocket(id: string, data: Uint8Array): void {
  const handle = handles.get(id);
  if (!handle) return;
  const buf = Buffer.from(data);
  if (handle.proto === "udp") {
    if (handle.peer) {
      handle.socket.send(buf, handle.peer.port, handle.peer.host);
    }
  } else if (!handle.socket.destroyed) {
    handle.socket.write(buf);
  }
}

function closeSocket(id: string): void {
  const handle = handles.get(id);
  if (!handle) return;
  handles.delete(id);
  try {
    if (handle.proto === "udp") {
      handle.socket.close();
    } else {
      handle.socket.destroy();
    }
  } catch {
    /* ignore */
  }
}

/** Tear down every open socket (called on app shutdown). */
export function closeAllSockets(): void {
  for (const id of [...handles.keys()]) {
    closeSocket(id);
  }
}

/** Register the net IPC handlers and bind pushes to the given window. */
export function setupNetSockets(window: BrowserWindow): void {
  mainWindow = window;

  /** Only the main window's own frame may drive these sockets. */
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
    mainWindow !== null &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents;

  ipcMain.handle("net:open", (e, spec: unknown) => {
    if (!fromMainWindow(e)) throw new Error("net:open: unauthorized sender");
    return openSocket(spec);
  });
  ipcMain.handle("net:send", (e, id: string, data: Uint8Array) => {
    if (!fromMainWindow(e)) throw new Error("net:send: unauthorized sender");
    sendSocket(id, data);
  });
  ipcMain.handle("net:close", (e, id: string) => {
    if (!fromMainWindow(e)) throw new Error("net:close: unauthorized sender");
    closeSocket(id);
  });

  // A renderer reload or crash leaves every socket bound and pushing
  // `net:data` into a renderer that discards it by id — forever, once per
  // reload. Tear them down with the document that opened them.
  window.webContents.on("did-start-navigation", (_e, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) closeAllSockets();
  });
  window.webContents.on("render-process-gone", () => closeAllSockets());
  window.on("closed", () => closeAllSockets());
}
