/**
 * The UDP listen socket learns its send peer ONCE.
 *
 * The guard used to be `handle.peer === null || spec.mode !== "target"`, whose
 * second clause is always true in listen mode — so the peer was overwritten by
 * the source address of the most recent datagram. The shipped default is
 * `{host: "0.0.0.0", port: 14550, mode: "listen"}`, which binds every
 * interface, so ONE spoofed datagram from anywhere on the operator's network
 * silently redirected every subsequent GCS→vehicle byte, arm and disarm
 * included.
 *
 * Driven through the real IPC handlers against real `dgram` sockets. A mocked
 * socket would only prove that the test's own fake echoes what the test put
 * in; the defect was in how a genuine `rinfo` was applied.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import dgram from "node:dgram";
import { once } from "node:events";

const { ipcHandlers, inbound } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  /** Every `net:data` push the module made to the renderer. */
  inbound: [] as unknown[],
}));

vi.mock("electron", () => ({
  app: { isPackaged: true },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
  BrowserWindow: class {},
}));

import { setupNetSockets, closeAllSockets } from "../../../electron/net-sockets";

/** The main-process window stand-in; the module only ever calls `send`. */
const fakeWindow = {
  isDestroyed: () => false,
  // `on` is here because the module now registers reload/teardown listeners:
  // every F5 used to leave the previous sockets bound and pushing `net:data`
  // into a renderer that discarded it by id, forever, once per reload.
  on: () => {},
  webContents: {
    on: () => {},
    send: (channel: string, payload: unknown) => {
      if (channel === "net:data") inbound.push(payload);
    },
  },
};

async function boundSocket(): Promise<{ socket: dgram.Socket; port: number }> {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const addr = socket.address();
  if (typeof addr === "string") throw new Error("expected an inet address");
  return { socket, port: addr.port };
}

/**
 * A port nothing is listening on.
 *
 * `net:open` takes an explicit port (a real caller passes 14550), so the test
 * picks one the OS just confirmed free and releases it immediately.
 */
async function freePort(): Promise<number> {
  const { socket, port } = await boundSocket();
  socket.close();
  await once(socket, "close");
  return port;
}

function sendTo(socket: dgram.Socket, port: number, byte: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.send(Buffer.from([0xfd, byte]), port, "127.0.0.1", (err) =>
    err ? reject(err) : resolve(),
  );
  return promise;
}

function handler(channel: string): (...args: unknown[]) => unknown {
  const fn = ipcHandlers.get(channel);
  if (!fn) throw new Error(`${channel} was never registered`);
  return fn;
}

/**
 * An invoke event from the main window's own frame.
 *
 * The handlers check `event.sender === mainWindow.webContents`, so a test
 * driving them has to present that identity — and a test that skipped the
 * check would no longer be exercising the shipped path.
 */
const mainWindowEvent = { sender: fakeWindow.webContents };

async function openSocket(spec: Record<string, unknown>): Promise<string> {
  const result = await handler("net:open")(mainWindowEvent, spec);
  if (!result || typeof result !== "object" || !("id" in result)) {
    throw new Error("net:open returned no id");
  }
  const { id } = result;
  if (typeof id !== "string") throw new Error("net:open id is not a string");
  return id;
}

/**
 * Resolve once the module has pushed `count` inbound datagrams.
 *
 * Awaiting the real push rather than sleeping: the condition is "both
 * datagrams have been observed", and a fixed delay would slow every run
 * while hiding the race it papers over.
 */
function awaitInbound(count: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const check = () => (inbound.length >= count ? resolve() : setImmediate(check));
  check();
  return promise;
}

describe("UDP listen-mode peer learning", () => {
  const opened: dgram.Socket[] = [];

  beforeEach(() => {
    ipcHandlers.clear();
    inbound.length = 0;
    setupNetSockets(
      fakeWindow as unknown as Parameters<typeof setupNetSockets>[0],
    );
  });

  afterEach(async () => {
    closeAllSockets();
    for (const s of opened) {
      s.close();
      await once(s, "close").catch(() => undefined);
    }
    opened.length = 0;
  });

  it("keeps the FIRST sender as the peer when a second sender appears", async () => {
    const listenPort = await freePort();
    const id = await openSocket({
      proto: "udp",
      host: "127.0.0.1",
      port: listenPort,
      mode: "listen",
    });

    const vehicle = await boundSocket();
    const attacker = await boundSocket();
    opened.push(vehicle.socket, attacker.socket);

    // The real vehicle speaks first; an attacker on the same network speaks
    // second. Both are observed before anything is sent back.
    await sendTo(vehicle.socket, listenPort, 0x01);
    await sendTo(attacker.socket, listenPort, 0x02);
    await awaitInbound(2);

    const atVehicle = once(vehicle.socket, "message");
    const atAttacker = once(attacker.socket, "message");

    await handler("net:send")(mainWindowEvent, id, new Uint8Array([0xfd, 0xaa]));

    // The reply must reach the vehicle, not whoever spoke most recently.
    const winner = await Promise.race([
      atVehicle.then(() => "vehicle" as const),
      atAttacker.then(() => "attacker" as const),
    ]);
    expect(winner).toBe("vehicle");
  });

  it("holds a target-mode peer fixed no matter who writes to it", async () => {
    const target = await boundSocket();
    const attacker = await boundSocket();
    opened.push(target.socket, attacker.socket);

    const id = await openSocket({
      proto: "udp",
      host: "127.0.0.1",
      port: target.port,
      mode: "target",
    });

    // An attacker writes to whatever ephemeral port the module bound. Even
    // if it found it, target mode must never relearn.
    const atTarget = once(target.socket, "message");
    await handler("net:send")(mainWindowEvent, id, new Uint8Array([0xfd, 0xbb]));
    await atTarget;

    expect(inbound.length).toBe(0);
  });
});
