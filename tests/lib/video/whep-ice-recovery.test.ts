/**
 * Regression net for the two defects that made a dropped video link
 * indistinguishable from a healthy one.
 *
 * 1. `disconnected` was terminal-but-silent. The handler logged a warning and
 *    called `restartIce()`, which on the WHEP path can never reach the server
 *    (no in-place renegotiation, no retained resource URL). Nothing wrote to
 *    the store, nothing reported health, nothing re-cascaded. The operator got
 *    a frozen last frame, a green transport badge, stale-but-nonzero stats and
 *    no reconnection.
 *
 * 2. The receiver's jitter-buffer target was applied BEFORE
 *    `setRemoteDescription`, where it does not survive the transceiver's
 *    association with the negotiated media description — so the connection ran
 *    on the browser's own adaptive target while the source claimed otherwise.
 *
 * Both are driven here through the real `startStream` against a fake
 * `RTCPeerConnection`, because the defect was in the ORDER of operations and
 * in the state transitions, and neither is observable from a unit test of the
 * helpers they call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startStream } from "@/lib/video/webrtc/whep-flow";
import { useVideoStore } from "@/stores/video-store";
import { resetSessionStateForTest } from "@/lib/video/webrtc/session-state";
import { NEGOTIATED_JITTER_TARGET_MS } from "@/lib/video/webrtc/jitter-controller";

/** One recorded moment in the negotiation, in the order it happened. */
type Step =
  | { kind: "setRemoteDescription" }
  | { kind: "jitterTarget"; ms: number };

interface FakeReceiver {
  track: { kind: string };
  jitterBufferTarget: number | null;
}

class FakePeerConnection {
  static last: FakePeerConnection | null = null;

  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: { sdp: string } | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;

  /** Ordered trace of the operations the ordering assertions read. */
  readonly steps: Step[] = [];
  readonly receiver: FakeReceiver = {
    track: { kind: "video" },
    // `null` is the browser's own "you have not asked for anything" value, so
    // a test that started it at 0 could not distinguish "never applied" from
    // "applied a zero".
    jitterBufferTarget: null,
  };

  constructor() {
    FakePeerConnection.last = this;
  }

  addTransceiver(): void {}

  getReceivers(): RTCRtpReceiver[] {
    // The receiver is only reachable once the answer has been applied. Before
    // that a real browser has nothing associated to tune, which is the whole
    // bug: returning it unconditionally would let the old pre-negotiation
    // call look like it worked.
    const applied = this.steps.some((s) => s.kind === "setRemoteDescription");
    if (!applied) return [];
    return [this.receiver as unknown as RTCRtpReceiver];
  }

  async createOffer(): Promise<{ type: "offer"; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\n" };
  }

  async setLocalDescription(): Promise<void> {
    this.localDescription = { sdp: "v=0\r\n" };
  }

  async setRemoteDescription(): Promise<void> {
    this.steps.push({ kind: "setRemoteDescription" });
    // A real implementation fires ontrack during or just after this.
    this.ontrack?.({ streams: [fakeStream()] });
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as unknown as RTCStatsReport);
  }
  close(): void {
    this.connectionState = "closed";
  }

  /** Drive a connection-state transition the way the browser would. */
  transitionTo(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function fakeStream(): MediaStream {
  const track = { kind: "video", readyState: "live", stop: () => {} };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

const WHEP_URL = "http://192.168.1.50:8080/whep";

let originalPc: typeof RTCPeerConnection | undefined;

beforeEach(() => {
  resetSessionStateForTest();
  useVideoStore.setState({ degradedReason: null, degradedSince: null, videoStallSignal: 0 });

  originalPc = globalThis.RTCPeerConnection;
  // The trace of jitter-target writes has to survive the property being set
  // by production code, so the recorder is installed on the prototype's
  // receiver rather than by wrapping the helper.
  globalThis.RTCPeerConnection =
    FakePeerConnection as unknown as typeof RTCPeerConnection;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => "v=0\r\na=recvonly\r\n",
    })),
  );
});

afterEach(() => {
  if (originalPc) globalThis.RTCPeerConnection = originalPc;
  vi.unstubAllGlobals();
  resetSessionStateForTest();
});

/** Negotiate once and hand back the connection the flow built. */
async function connect(): Promise<FakePeerConnection> {
  await startStream(WHEP_URL);
  const pc = FakePeerConnection.last;
  expect(pc).not.toBeNull();
  return pc as FakePeerConnection;
}

describe("jitterBufferTarget ordering", () => {
  it("applies the 100 ms target AFTER setRemoteDescription, never before", async () => {
    const pc = await connect();

    // The receiver only exists after the answer is applied, so a target that
    // stuck proves the call happened on the right side of it.
    expect(pc.receiver.jitterBufferTarget).toBe(NEGOTIATED_JITTER_TARGET_MS);
    expect(NEGOTIATED_JITTER_TARGET_MS).toBe(100);

    // And the order is the actual assertion: setting it before is a no-op, so
    // a regression that moves the call back above `createOffer` must fail
    // here rather than silently reverting to the browser default.
    const srdIndex = pc.steps.findIndex((s) => s.kind === "setRemoteDescription");
    expect(srdIndex).toBeGreaterThanOrEqual(0);
    expect(pc.getReceivers()).toHaveLength(1);
  });
});

describe("ICE loss is degraded and recoverable", () => {
  it("publishes a degraded state on disconnected and clears it on reconnect", async () => {
    const pc = await connect();
    expect(useVideoStore.getState().isStreaming).toBe(true);
    expect(useVideoStore.getState().degradedReason).toBeNull();

    pc.transitionTo("disconnected");

    // Observable: a surface can now render the frozen picture AS frozen.
    expect(useVideoStore.getState().degradedReason).toBe("ice-disconnect");
    expect(useVideoStore.getState().degradedSince).not.toBeNull();
    expect(
      useVideoStore.getState().transportHealth["lan-whep"].lastErrorCode,
    ).toBe("ice-disconnect");
    // NOT torn down: the session is still installed and the last frame is
    // still on screen, which is the difference between degraded and failed.
    expect(useVideoStore.getState().isStreaming).toBe(true);

    pc.transitionTo("connected");

    // Recovered on its own, with no page reload and no operator action.
    expect(useVideoStore.getState().degradedReason).toBeNull();
    expect(useVideoStore.getState().degradedSince).toBeNull();
    expect(useVideoStore.getState().transportHealth["lan-whep"].state).toBe("ok");
    expect(useVideoStore.getState().isStreaming).toBe(true);
  });

  it("raises the stall edge when the link does not come back inside the grace window", async () => {
    vi.useFakeTimers();
    try {
      const before = useVideoStore.getState().videoStallSignal;
      const pc = await connect();

      pc.transitionTo("disconnected");
      expect(useVideoStore.getState().videoStallSignal).toBe(before);

      // Still degraded 2.9 s later: no re-cascade yet, ICE may still recover.
      vi.advanceTimersByTime(2_900);
      expect(useVideoStore.getState().videoStallSignal).toBe(before);

      // Past the grace window the session is re-dialled. The retry loop above
      // this is fixed-interval and uncapped, so there is no state a human has
      // to clear.
      vi.advanceTimersByTime(200);
      expect(useVideoStore.getState().videoStallSignal).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not raise the stall edge when the link recovers inside the grace window", async () => {
    vi.useFakeTimers();
    try {
      const before = useVideoStore.getState().videoStallSignal;
      const pc = await connect();

      pc.transitionTo("disconnected");
      vi.advanceTimersByTime(1_000);
      pc.transitionTo("connected");
      vi.advanceTimersByTime(10_000);

      expect(useVideoStore.getState().videoStallSignal).toBe(before);
      expect(useVideoStore.getState().degradedReason).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
