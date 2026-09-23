import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  useDroneCanBusStore,
  type DecodedFrame,
} from "@/stores/dronecan/bus-store";
import { RingBuffer } from "@/lib/ring-buffer";

function makeFrame(overrides: Partial<DecodedFrame> = {}): DecodedFrame {
  return {
    t: Date.now(),
    dir: "in",
    canId: 0x1abcdef0,
    decoded: {
      kind: "message",
      dataTypeId: 341,
      srcNodeId: 1,
    },
    payload: new Uint8Array(7),
    ...overrides,
  };
}

/**
 * Drain the coalesced publish.
 *
 * `pushFrame` mutates the ring and the tallies immediately but publishes
 * to the store on one animation frame, so a saturated bus produces one
 * React notification per frame instead of several thousand per second.
 * Every assertion on published state has to cross that boundary.
 */
function flushFrame() {
  vi.advanceTimersToNextFrame();
}

describe("useDroneCanBusStore", () => {
  beforeEach(() => {
    // `requestAnimationFrame` must be faked too: the store publishes its
    // counters on one animation frame rather than on every pushed frame,
    // so without it a real frame lands between tests and the assertions
    // become order-dependent.
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    useDroneCanBusStore.setState({
      frames: new RingBuffer<DecodedFrame>(4096),
      counters: { fps: 0, errorsPs: 0, bytesIn: 0, bytesOut: 0 },
      paused: false,
      _version: 0,
      _lastTallyAt: Date.now(),
      _framesSinceTally: 0,
      _errorsSinceTally: 0,
    });
    // Also zeroes the out-of-store tally the coalesced publish reads from.
    useDroneCanBusStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushFrame respects 4096 cap", () => {
    const { pushFrame } = useDroneCanBusStore.getState();
    for (let i = 0; i < 5000; i++) pushFrame(makeFrame());
    expect(useDroneCanBusStore.getState().frames.length).toBe(4096);
  });

  it("pause() stops accepting new frames", () => {
    const store = useDroneCanBusStore.getState();
    store.pushFrame(makeFrame());
    store.pushFrame(makeFrame());
    expect(useDroneCanBusStore.getState().frames.length).toBe(2);

    useDroneCanBusStore.getState().pause();
    for (let i = 0; i < 10; i++) {
      useDroneCanBusStore.getState().pushFrame(makeFrame());
    }
    expect(useDroneCanBusStore.getState().frames.length).toBe(2);
  });

  it("resume() restarts frame intake and resets counters tally window", () => {
    const store = useDroneCanBusStore.getState();
    store.pause();
    store.pushFrame(makeFrame());
    expect(useDroneCanBusStore.getState().frames.length).toBe(0);

    useDroneCanBusStore.getState().resume();
    useDroneCanBusStore.getState().pushFrame(makeFrame());
    expect(useDroneCanBusStore.getState().frames.length).toBe(1);
  });

  it("counters accumulate bytes by direction", () => {
    const { pushFrame } = useDroneCanBusStore.getState();
    pushFrame(makeFrame({ dir: "in", payload: new Uint8Array(8) }));
    pushFrame(makeFrame({ dir: "out", payload: new Uint8Array(4) }));
    flushFrame();
    const counters = useDroneCanBusStore.getState().counters;
    expect(counters.bytesIn).toBe(8);
    expect(counters.bytesOut).toBe(4);
  });

  it("fps tallies on a 1s rolling window", () => {
    const { pushFrame } = useDroneCanBusStore.getState();
    for (let i = 0; i < 30; i++) pushFrame(makeFrame());
    flushFrame();
    expect(useDroneCanBusStore.getState().counters.fps).toBe(0);
    vi.advanceTimersByTime(1_001);
    pushFrame(makeFrame());
    flushFrame();
    expect(useDroneCanBusStore.getState().counters.fps).toBeGreaterThan(0);
  });

  it("fps and errors/s fall to 0 once frames stop arriving", () => {
    const { pushFrame } = useDroneCanBusStore.getState();
    for (let i = 0; i < 50; i++) pushFrame(makeFrame({ error: i % 10 === 0 }));
    vi.advanceTimersByTime(1_000);
    flushFrame();
    expect(useDroneCanBusStore.getState().counters.fps).toBe(50);
    expect(useDroneCanBusStore.getState().counters.errorsPs).toBe(5);

    // No frames for the next window: the rate must decay, not freeze.
    vi.advanceTimersByTime(1_000);
    flushFrame();
    const after = useDroneCanBusStore.getState();
    expect(after.counters.fps).toBe(0);
    expect(after.counters.errorsPs).toBe(0);
    expect(after.lastFrameAt).toBe(new Date(2026, 0, 1, 12, 0, 0).getTime());
  });

  it("clear() resets buffer and counters", () => {
    const { pushFrame } = useDroneCanBusStore.getState();
    pushFrame(makeFrame({ dir: "in", payload: new Uint8Array(8) }));
    useDroneCanBusStore.getState().clear();
    const after = useDroneCanBusStore.getState();
    expect(after.frames.length).toBe(0);
    expect(after.counters.bytesIn).toBe(0);
    expect(after.lastFrameAt).toBeNull();
  });
});
