/**
 * Regression net for the per-hop receive latency budget.
 *
 * The bug this replaces: the video surfaces reported one roll-up number —
 * ICE round-trip time plus the decoder's average jitter buffer wait — as
 * "latency". Round-trip time is a round trip and contains no capture or
 * encode leg at all, so the roll-up was not even the same quantity as
 * end-to-end latency, and it told an operator nothing about where the delay
 * was.
 *
 * The arithmetic here is a handful of subtractions, which is exactly why it
 * needs pinning: getting one backwards produces a plausible-looking number
 * rather than an error, and a latency figure nobody can trace is worse than
 * no figure.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LATENCY_HOP_PROVENANCE,
  UNAVAILABLE_HOPS,
  deriveLatencySample,
  getLatencyBudget,
  observeFrameLatency,
  recordLatencySample,
  resetLatencyBudget,
  subscribeLatencyBudget,
  type FrameLatencyMetadata,
  type LatencyHopId,
} from "@/lib/video/latency-budget";

/**
 * A frame with a clean split: 120 ms capture→receive, 40 ms receive→present
 * (12 of it decode), 8 ms of predicted v-sync tax.
 */
function frame(overrides: Partial<FrameLatencyMetadata> = {}): FrameLatencyMetadata {
  return {
    captureTime: 1_000,
    receiveTime: 1_120,
    presentationTime: 1_160,
    expectedDisplayTime: 1_168,
    processingDuration: 12,
    rtpTimestamp: 42,
    ...overrides,
  };
}

beforeEach(() => {
  resetLatencyBudget();
});

describe("deriving one frame's hops", () => {
  it("splits the receive path in the right direction", () => {
    const sample = deriveLatencySample(frame());
    expect(sample).not.toBeNull();
    expect(sample!.captureToReceiveMs).toBe(120);
    expect(sample!.receiveToPresentMs).toBe(40);
    expect(sample!.decodeMs).toBe(12);
    // A subtraction, not an observation — nothing reports this hop.
    expect(sample!.bufferAndCompositeMs).toBe(28);
    expect(sample!.presentToDisplayMs).toBe(8);
    // End to end is capture → presented, NOT capture → predicted display.
    expect(sample!.endToEndMs).toBe(160);
  });

  it("returns null without captureTime — a non-WebRTC source has none", () => {
    expect(deriveLatencySample(frame({ captureTime: undefined }))).toBeNull();
    expect(deriveLatencySample(frame({ receiveTime: undefined }))).toBeNull();
  });

  it("rejects a negative hop rather than reporting it", () => {
    // receiveTime before captureTime: the RTCP clock synchronisation has not
    // converged, which it has not for the first second or so of a session.
    expect(deriveLatencySample(frame({ receiveTime: 900 }))).toBeNull();
    // presentationTime before receiveTime is likewise impossible.
    expect(deriveLatencySample(frame({ presentationTime: 1_100 }))).toBeNull();
  });

  it("rejects an implausible end-to-end figure", () => {
    // Six seconds of glass-to-glass is not a measurement, it is an
    // unconverged clock offset that would drag the percentiles somewhere no
    // operator should read.
    expect(
      deriveLatencySample(
        frame({ presentationTime: 7_000, expectedDisplayTime: 7_008 }),
      ),
    ).toBeNull();
  });

  it("does not let a missing processingDuration read as zero decode", () => {
    const sample = deriveLatencySample(
      frame({ processingDuration: undefined }),
    )!;
    // With no decode figure the derived remainder must absorb the whole
    // receive leg, never claim the decoder took 0 ms.
    expect(sample.decodeMs).toBe(0);
    expect(sample.bufferAndCompositeMs).toBe(sample.receiveToPresentMs);
  });

  it("never lets decode exceed the leg that contains it", () => {
    const sample = deriveLatencySample(frame({ processingDuration: 999 }))!;
    expect(sample.decodeMs).toBe(sample.receiveToPresentMs);
    expect(sample.bufferAndCompositeMs).toBe(0);
  });
});

describe("percentiles and provenance", () => {
  it("reports nothing until a frame with usable timestamps arrives", () => {
    expect(getLatencyBudget().samples).toBe(0);
    expect(getLatencyBudget().hops).toBeNull();
    // A frame with no captureTime must not create an empty-but-present
    // budget: a surface would render zeros as measurements.
    observeFrameLatency(frame({ captureTime: undefined }));
    expect(getLatencyBudget().hops).toBeNull();
  });

  it("computes P50 and P95 over the window", () => {
    for (let i = 1; i <= 100; i += 1) {
      recordLatencySample({
        captureToReceiveMs: i,
        receiveToPresentMs: i,
        decodeMs: 1,
        bufferAndCompositeMs: i - 1,
        presentToDisplayMs: 1,
        endToEndMs: i * 2,
      });
    }
    const budget = getLatencyBudget();
    expect(budget.samples).toBe(100);
    expect(budget.hops!.captureToReceive.p50Ms).toBe(50);
    expect(budget.hops!.captureToReceive.p95Ms).toBe(95);
    expect(budget.hops!.endToEnd.p50Ms).toBe(100);
    expect(budget.hops!.endToEnd.p95Ms).toBe(190);
  });

  it("labels every hop with how its number was obtained", () => {
    observeFrameLatency(frame());
    const { hops } = getLatencyBudget();
    // Anchored on captureTime, which the user agent estimates from RTCP
    // sender reports — real, but only as good as that synchronisation.
    expect(hops!.captureToReceive.provenance).toBe("rtcp-synchronised");
    expect(hops!.endToEnd.provenance).toBe("rtcp-synchronised");
    // Two directly-reported timestamps on the performance.now() clock.
    expect(hops!.receiveToPresent.provenance).toBe("measured");
    expect(hops!.decode.provenance).toBe("measured");
    // A subtraction of the two above.
    expect(hops!.bufferAndComposite.provenance).toBe("derived");
    // expectedDisplayTime is a PREDICTION, not a report.
    expect(hops!.presentToDisplay.provenance).toBe("ua-estimated");

    // No hop may be presented as measured when it is not.
    const all = hops!;
    for (const id of Object.keys(all) as LatencyHopId[]) {
      expect(all[id].provenance).toBe(LATENCY_HOP_PROVENANCE[id]);
    }
  });

  it("names the hops no browser can measure instead of leaving a gap", () => {
    observeFrameLatency(frame());
    // A missing term reads as zero. The media server's share sits inside
    // capture→receive and cannot be separated from it by a receiver.
    expect(getLatencyBudget().unavailable).toEqual(UNAVAILABLE_HOPS);
    expect(getLatencyBudget().unavailable.length).toBeGreaterThan(0);
  });

  it("returns a cached snapshot between changes", () => {
    observeFrameLatency(frame());
    const first = getLatencyBudget();
    // React's getSnapshot contract: allocating a fresh object per call is
    // the documented cause of an infinite re-render loop.
    expect(getLatencyBudget()).toBe(first);
    observeFrameLatency(frame({ receiveTime: 1_100 }));
    expect(getLatencyBudget()).not.toBe(first);
  });

  it("drops the window on reset so a reconnect starts clean", () => {
    observeFrameLatency(frame());
    expect(getLatencyBudget().samples).toBe(1);
    resetLatencyBudget();
    // Percentiles carried across a reconnect describe a link that no longer
    // exists.
    expect(getLatencyBudget().samples).toBe(0);
    expect(getLatencyBudget().hops).toBeNull();
  });

  it("bounds the window rather than growing without limit", () => {
    for (let i = 0; i < 5_000; i += 1) {
      recordLatencySample({
        captureToReceiveMs: 10,
        receiveToPresentMs: 10,
        decodeMs: 1,
        bufferAndCompositeMs: 9,
        presentToDisplayMs: 1,
        endToEndMs: 20,
      });
    }
    // Frames arrive at up to the display rate for the life of a flight.
    expect(getLatencyBudget().samples).toBeLessThanOrEqual(300);
  });
});

describe("notification rate", () => {
  it("does not notify per frame", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLatencyBudget(listener);
    // 30 frames inside one notification interval: a subscriber that
    // re-rendered per frame would cost more than the measurement is worth,
    // and the percentiles do not move meaningfully at that rate anyway.
    for (let i = 0; i < 30; i += 1) observeFrameLatency(frame());
    expect(listener.mock.calls.length).toBeLessThan(30);
    unsubscribe();
  });

  it("stops notifying an unsubscribed listener", () => {
    const listener = vi.fn();
    subscribeLatencyBudget(listener)();
    resetLatencyBudget();
    expect(listener).not.toHaveBeenCalled();
  });
});
