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
  close() {}
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

  it("stops and reports closed when the agent refuses the stream for this profile", async () => {
    const states: string[] = [];
    subscribeWebSocket({
      ctx,
      path: "/ws",
      scope: "gs.pic_events",
      onEvent: () => {},
      onState: (s) => states.push(s),
    });
    await flush();
    FakeWebSocket.instances[0].onopen?.();
    FakeWebSocket.instances[0].onclose?.({ code: 1008 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(states).toEqual(["connected", "closed"]);
  });
});
