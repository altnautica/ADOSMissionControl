/**
 * The desktop UDP listen socket learns its send peer ONCE, from the first
 * local MAVLink frame, and client-side route changes never tear the native
 * sockets down.
 *
 * The shipped default is `{host: "0.0.0.0", port: 14550, mode: "listen"}`,
 * which binds every interface, so a peer that could be (re)learned from any
 * datagram let one spoofed packet redirect every GCS→vehicle byte, arm and
 * disarm included.
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

const { ipcHandlers, inbound, closes, navListeners } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  /** Every `net:data` push the module made to the renderer. */
  inbound: [] as unknown[],
  /** Every `net:close` push the module made to the renderer. */
  closes: [] as unknown[],
  /** `did-start-navigation` listeners the module registered. */
  navListeners: [] as ((...args: unknown[]) => void)[],
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
  on: () => {},
  webContents: {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (event === "did-start-navigation") navListeners.push(listener);
    },
    send: (channel: string, payload: unknown) => {
      if (channel === "net:data") inbound.push(payload);
      if (channel === "net:close") closes.push(payload);
    },
  },
};

/**
 * Emit `did-start-navigation` the way Electron does: the details object
 * first, then the deprecated positional url / isInPlace / isMainFrame.
 */
function navigate(isSameDocument: boolean): void {
  const details = { url: "http://localhost:4000/plan", isSameDocument, isMainFrame: true };
  for (const listener of navListeners) {
    listener(details, details.url, isSameDocument, true, 0, 0);
  }
}

/** A structurally complete MAVLink v2 HEARTBEAT (9-byte payload). */
function mavlinkFrame(sysid: number): Buffer {
  const frame = Buffer.alloc(21);
  frame[0] = 0xfd;
  frame[1] = 9;
  frame[5] = sysid;
  frame[6] = 1;
  return frame;
}

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

function sendTo(socket: dgram.Socket, port: number, payload: Buffer): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  socket.send(payload, port, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
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

/** Which of two sockets receives the next datagram first. */
function firstReceiver(
  a: dgram.Socket,
  b: dgram.Socket,
): Promise<"first" | "second"> {
  return Promise.race([
    once(a, "message").then(() => "first" as const),
    once(b, "message").then(() => "second" as const),
  ]);
}

describe("UDP listen-mode peer learning", () => {
  const opened: dgram.Socket[] = [];

  beforeEach(() => {
    ipcHandlers.clear();
    inbound.length = 0;
    closes.length = 0;
    navListeners.length = 0;
    setupNetSockets(
      fakeWindow as unknown as Parameters<typeof setupNetSockets>[0],
    );
  });

  afterEach(async () => {
    closeAllSockets("test teardown");
    for (const s of opened) {
      s.close();
      await once(s, "close").catch(() => undefined);
    }
    opened.length = 0;
  });

  async function listen(): Promise<{ id: string; port: number }> {
    const port = await freePort();
    const id = await openSocket({ proto: "udp", host: "127.0.0.1", port, mode: "listen" });
    return { id, port };
  }

  it("keeps the FIRST sender as the peer when a second sender appears", async () => {
    const { id, port } = await listen();
    const vehicle = await boundSocket();
    const attacker = await boundSocket();
    opened.push(vehicle.socket, attacker.socket);

    // The real vehicle speaks first; an attacker on the same network speaks
    // second. Both are observed before anything is sent back.
    await sendTo(vehicle.socket, port, mavlinkFrame(1));
    await sendTo(attacker.socket, port, mavlinkFrame(1));
    await awaitInbound(2);

    const winner = firstReceiver(vehicle.socket, attacker.socket);
    await handler("net:send")(mainWindowEvent, id, new Uint8Array([0xfd, 0xaa]));
    expect(await winner).toBe("first");
  });

  it("does not learn the peer from a datagram that is not a MAVLink frame", async () => {
    const { id, port } = await listen();
    const noise = await boundSocket();
    const vehicle = await boundSocket();
    opened.push(noise.socket, vehicle.socket);

    await sendTo(noise.socket, port, Buffer.from([0x01, 0x02, 0x03]));
    await sendTo(vehicle.socket, port, mavlinkFrame(1));
    await awaitInbound(2);

    const winner = firstReceiver(noise.socket, vehicle.socket);
    await handler("net:send")(mainWindowEvent, id, new Uint8Array([0xfd, 0xaa]));
    expect(await winner).toBe("second");
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

describe("socket lifetime across navigation", () => {
  const opened: dgram.Socket[] = [];

  beforeEach(() => {
    ipcHandlers.clear();
    closes.length = 0;
    navListeners.length = 0;
    setupNetSockets(
      fakeWindow as unknown as Parameters<typeof setupNetSockets>[0],
    );
  });

  afterEach(async () => {
    closeAllSockets("test teardown");
    for (const s of opened) {
      s.close();
      await once(s, "close").catch(() => undefined);
    }
    opened.length = 0;
  });

  async function openTarget(): Promise<{ id: string; target: dgram.Socket }> {
    const target = await boundSocket();
    opened.push(target.socket);
    const id = await openSocket({
      proto: "udp",
      host: "127.0.0.1",
      port: target.port,
      mode: "target",
    });
    return { id, target: target.socket };
  }

  it("keeps the socket open across a client-side route change", async () => {
    const { id, target } = await openTarget();

    navigate(true);

    expect(closes).toEqual([]);
    const arrived = once(target, "message");
    await handler("net:send")(mainWindowEvent, id, new Uint8Array([0xfd, 0xcc]));
    await arrived;
  });

  it("closes the socket and tells the renderer on a full page navigation", async () => {
    const { id } = await openTarget();

    navigate(false);

    expect(closes).toEqual([{ id, reason: "page navigated away" }]);
  });
});

describe("net:open endpoint validation", () => {
  beforeEach(() => {
    ipcHandlers.clear();
    closes.length = 0;
    navListeners.length = 0;
    setupNetSockets(
      fakeWindow as unknown as Parameters<typeof setupNetSockets>[0],
    );
  });

  afterEach(() => {
    closeAllSockets("test teardown");
  });

  /** ipcMain turns a handler's synchronous throw into a rejected invoke. */
  const invokeOpen = (event: unknown, spec: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve().then(() => handler("net:open")(event, spec));

  it.each(["8.8.8.8", "203.0.113.9", "attacker.example", "10.attacker.example", "2001:db8::1"])(
    "refuses the non-local endpoint %s",
    async (host) => {
      await expect(
        invokeOpen(mainWindowEvent, { proto: "udp", host, port: 14550, mode: "target" }),
      ).rejects.toThrow(/non-local endpoint/);
    },
  );

  it.each(["100.64.0.1", "192.168.1.50", "fe90::1", "[fd00::1]"])(
    "accepts the local endpoint %s",
    async (host) => {
      const id = await openSocket({ proto: "udp", host, port: 14550, mode: "target" });
      expect(typeof id).toBe("string");
    },
  );

  it("refuses an invoke from any frame other than the main window", async () => {
    const popupEvent = { sender: { id: "popup" } };
    await expect(
      invokeOpen(popupEvent, { proto: "udp", host: "127.0.0.1", port: 14550, mode: "target" }),
    ).rejects.toThrow(/unauthorized sender/);
  });
});
