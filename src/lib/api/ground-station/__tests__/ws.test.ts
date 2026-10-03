import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ws-ticket", () => ({
  WS_TICKET_PROTOCOL: "ados.ticket",
  mintWsTicket: vi.fn(() => Promise.resolve("ticket")),
}));

import { subscribeWebSocket } from "../ws";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  closed = false;
  close() {
    this.closed = true;
  }
}

const ctx = { baseUrl: "http://192.168.1.50:8080", apiKey: "k" };

async function flush() {
  // Let the ticket mint's promise resolve and the socket get constructed.
  await vi.advanceTimersByTimeAsync(0);
}

describe("subscribeWebSocket reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits the full fixed delay after an open-then-close instead of retrying at once", async () => {
    const stop = subscribeWebSocket({ ctx, path: "/ws", scope: "gs.pic_events", onEvent: () => {} });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Accepted, then closed right away (a relay whose bus is down).
    FakeWebSocket.instances[0].onopen?.();
    FakeWebSocket.instances[0].onclose?.({ code: 1011 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    stop();
  });

  it("redials on a slower fixed cadence after a profile refusal instead of stopping", async () => {
    const states: string[] = [];
    const stop = subscribeWebSocket({
      ctx,
      path: "/ws",
      scope: "gs.pic_events",
      onEvent: () => {},
      onState: (s) => states.push(s),
    });
    await flush();
    FakeWebSocket.instances[0].onopen?.();
    FakeWebSocket.instances[0].onclose?.({ code: 1008 });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Still refused on the next dial: the loop keeps going, never "closed".
    FakeWebSocket.instances[1].onopen?.();
    FakeWebSocket.instances[1].onclose?.({ code: 1008 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(states).toEqual(["connected", "reconnecting", "connected", "reconnecting"]);
    stop();
  });

  it("abandons a dial that neither opens nor closes within the connect deadline", async () => {
    const stop = subscribeWebSocket({ ctx, path: "/ws", scope: "gs.pic_events", onEvent: () => {} });
    await flush();
    const hung = FakeWebSocket.instances[0];
    await vi.advanceTimersByTimeAsync(4_999);
    expect(hung.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(hung.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // A late open on the abandoned socket does not count as connected.
    expect(hung.onopen).toBeNull();
    stop();
  });

  it("redials an open socket that delivers no frame for the liveness timeout", async () => {
    const events: unknown[] = [];
    const states: string[] = [];
    const stop = subscribeWebSocket({
      ctx,
      path: "/ws",
      scope: "gs.uplink_events",
      onEvent: (e) => events.push(e),
      onState: (s) => states.push(s),
    });
    await flush();
    const ws = FakeWebSocket.instances[0];
    ws.onopen?.();
    // Keepalives hold the socket open and never reach the consumer.
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(5_000);
      ws.onmessage?.({ data: JSON.stringify({ kind: "keepalive" }) });
    }
    ws.onmessage?.({ data: JSON.stringify({ kind: "health_changed" }) });
    expect(ws.closed).toBe(false);
    expect(events).toEqual([{ kind: "health_changed" }]);

    // The peer vanishes without a close: 15 s of silence drops it.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(ws.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.closed).toBe(true);
    expect(states).toEqual(["connected", "reconnecting"]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    stop();
  });

  it("leaves a quiet socket open when the stream sends no keepalive", async () => {
    const stop = subscribeWebSocket({
      ctx,
      path: "/ws",
      scope: "vision.detections",
      onEvent: () => {},
      peerSendsKeepalive: false,
    });
    await flush();
    FakeWebSocket.instances[0].onopen?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances[0].closed).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
    stop();
  });
});
