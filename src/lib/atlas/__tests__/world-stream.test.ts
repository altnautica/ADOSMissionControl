/**
 * @license GPL-3.0-only
 *
 * The descriptor-stream client: URL derivation onto the compute engine's own
 * listener, binary frame handoff, reconnect, and teardown. The socket is
 * injected, so this exercises the real state machine with no server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  subscribeWorldStream,
  WORLD_STREAM_MAX_RETRY_MS,
  WORLD_STREAM_PORT,
  WORLD_WS_ROUTE,
  worldStreamUrl,
  worldWsPath,
  type WorldStreamSocket,
  type WorldStreamState,
} from "../world-stream";

/** A hand-driven stand-in for the browser socket. */
class FakeSocket implements WorldStreamSocket {
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
}

describe("URL derivation", () => {
  it("matches the agent's route shape", () => {
    expect(WORLD_WS_ROUTE).toBe("/ws/atlas/:device_id");
    expect(worldWsPath("drone-1")).toBe("/ws/atlas/drone-1");
  });

  it("percent-encodes a device id so a path separator cannot escape the route", () => {
    expect(worldWsPath("dr one/7")).toBe("/ws/atlas/dr%20one%2F7");
  });

  it("swaps in the engine port and the ws scheme", () => {
    expect(worldStreamUrl("http://ados-x.local:8080", "drone-1")).toBe(
      `ws://ados-x.local:${WORLD_STREAM_PORT}/ws/atlas/drone-1`,
    );
    // A base with no explicit port still lands on the engine listener.
    expect(worldStreamUrl("http://192.168.1.50", "drone-1")).toBe(
      `ws://192.168.1.50:${WORLD_STREAM_PORT}/ws/atlas/drone-1`,
    );
  });

  it("carries an https base across to wss rather than assuming plaintext", () => {
    expect(worldStreamUrl("https://node.example.com", "d")).toBe(
      `wss://node.example.com:${WORLD_STREAM_PORT}/ws/atlas/d`,
    );
  });

  it("returns null for a base that is not a URL", () => {
    expect(worldStreamUrl("not a url", "d")).toBeNull();
    expect(worldStreamUrl("", "d")).toBeNull();
  });
});

describe("subscribeWorldStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hands binary frames over as bytes and reports connect state", () => {
    const sockets: FakeSocket[] = [];
    const frames: Uint8Array[] = [];
    const states: WorldStreamState[] = [];
    const stop = subscribeWorldStream({
      url: "ws://node:8092/ws/atlas/d",
      onFrame: (f) => frames.push(f),
      onState: (s) => states.push(s),
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });

    expect(states).toEqual(["connecting"]);
    expect(sockets[0].binaryType).toBe("arraybuffer");
    sockets[0].onopen?.();
    expect(states).toEqual(["connecting", "connected"]);

    sockets[0].onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer });
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0])).toEqual([1, 2, 3]);

    stop();
    expect(sockets[0].closed).toBe(true);
  });

  it("ignores a text frame instead of counting it as a descriptor", () => {
    const sockets: FakeSocket[] = [];
    const frames: Uint8Array[] = [];
    const stop = subscribeWorldStream({
      url: "ws://node:8092/ws/atlas/d",
      onFrame: (f) => frames.push(f),
      onState: () => {},
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    sockets[0].onmessage?.({ data: "hello" });
    expect(frames).toHaveLength(0);
    stop();
  });

  it("reconnects after a close, backing off to the ceiling", () => {
    const sockets: FakeSocket[] = [];
    const states: WorldStreamState[] = [];
    const stop = subscribeWorldStream({
      url: "ws://node:8092/ws/atlas/d",
      onFrame: () => {},
      onState: (s) => states.push(s),
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });

    sockets[0].onclose?.();
    expect(states).toEqual(["connecting", "reconnecting"]);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    // Keep failing; the delay must settle at the ceiling rather than grow.
    for (let i = 0; i < 10; i++) {
      sockets[sockets.length - 1].onclose?.();
      vi.advanceTimersByTime(WORLD_STREAM_MAX_RETRY_MS);
    }
    const settled = sockets.length;
    sockets[settled - 1].onclose?.();
    vi.advanceTimersByTime(WORLD_STREAM_MAX_RETRY_MS);
    expect(sockets.length).toBe(settled + 1);

    stop();
  });

  it("resets the backoff once a connection opens", () => {
    const sockets: FakeSocket[] = [];
    const stop = subscribeWorldStream({
      url: "ws://node:8092/ws/atlas/d",
      onFrame: () => {},
      onState: () => {},
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    sockets[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    sockets[1].onopen?.();
    sockets[1].onclose?.();
    // Back to the first delay, not the doubled one.
    vi.advanceTimersByTime(WORLD_STREAM_MAX_RETRY_MS);
    expect(sockets).toHaveLength(3);
    stop();
  });

  it("stops reconnecting after teardown", () => {
    const sockets: FakeSocket[] = [];
    const stop = subscribeWorldStream({
      url: "ws://node:8092/ws/atlas/d",
      onFrame: () => {},
      onState: () => {},
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    sockets[0].onclose?.();
    stop();
    vi.advanceTimersByTime(WORLD_STREAM_MAX_RETRY_MS * 5);
    expect(sockets).toHaveLength(1);
  });

  it("retries when the socket constructor throws rather than giving up", () => {
    let calls = 0;
    const stop = subscribeWorldStream({
      url: "ws://node:8092/ws/atlas/d",
      onFrame: () => {},
      onState: () => {},
      socketFactory: () => {
        calls += 1;
        throw new Error("refused");
      },
    });
    expect(calls).toBe(1);
    // The first retry lands on the base delay; advancing further would fire
    // several doublings and stop measuring the first one.
    vi.advanceTimersByTime(500);
    expect(calls).toBe(2);
    stop();
  });
});
