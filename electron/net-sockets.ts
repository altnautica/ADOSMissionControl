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
import { randomUUID } from "node:crypto";
import { UdpPeerTracker, isLocalEndpoint } from "./udp-peer";

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
  // `net:open` is the entire renderer-to-main attack surface: only loopback /
  // LAN endpoints the operator can mean are ever bound or dialled, so an
  // HTML-injection sink in the app cannot become LAN port-scanning.
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
  /** Where GCS→drone bytes go: the fixed target, or the peer learned once in
   *  listen mode. */
  peers: UdpPeerTracker;
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
        peers: new UdpPeerTracker(
          spec.mode === "target" ? { host: spec.host, port: spec.port } : null,
        ),
      };

      let settled = false;

      socket.on("message", (msg, rinfo) => {
        // Non-local sources are dropped before they can reach the MAVLink
        // parser or become the peer. The peer is learned once, from the first
        // local MAVLink frame; the shipped default binds 0.0.0.0:14550, so a
        // later sender (a spoofed datagram from the field network) must never
        // redirect arm/disarm, mode changes or mission uploads.
        if (handle.peers.observe(rinfo.address, rinfo.port, msg) === "drop") return;
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
    const peer = handle.peers.peer;
    if (peer) handle.socket.send(buf, peer.port, peer.host);
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

/**
 * Tear down every open socket and tell the renderer each one is gone, so its
 * transport never keeps reporting a link whose socket no longer exists.
 */
export function closeAllSockets(reason: string): void {
  for (const id of [...handles.keys()]) {
    closeSocket(id);
    pushToRenderer("net:close", { id, reason });
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

  // A renderer reload, crash or cross-document navigation leaves every socket
  // bound and pushing `net:data` into a document that no longer owns it. A
  // same-document navigation (client-side route change via history.pushState)
  // keeps the document, and with it the live link.
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      closeAllSockets("page navigated away");
    }
  });
  window.webContents.on("render-process-gone", () => closeAllSockets("renderer exited"));
  window.on("closed", () => closeAllSockets("window closed"));
}
