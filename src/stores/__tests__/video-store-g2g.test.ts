/**
 * Glass-to-glass samples arrive once per presented frame. The store publishes
 * the rolling figure at most four times a second, so a 30 fps stream does not
 * re-render every `latency` subscriber 30 times a second, and the last sample
 * of a burst still lands.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { G2G_PUBLISH_INTERVAL_MS } from "@/lib/video/g2g-ring";
import { useVideoStore } from "@/stores/video-store";

describe("recordG2GSample", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useVideoStore.getState().resetLatency();
  });
  afterEach(() => {
    useVideoStore.getState().resetLatency();
    vi.useRealTimers();
  });

  it("publishes at most 4 Hz from a 30 fps sample stream", () => {
    expect(G2G_PUBLISH_INTERVAL_MS).toBeGreaterThanOrEqual(250);
    let writes = 0;
    const unsubscribe = useVideoStore.subscribe((s, prev) => {
      if (s.latency !== prev.latency) writes += 1;
    });
    for (let i = 0; i < 60; i += 1) {
      useVideoStore.getState().recordG2GSample(100 + i);
      vi.advanceTimersByTime(1000 / 30);
    }
    unsubscribe();
    // Two seconds of frames: one leading publish plus one per interval.
    expect(writes).toBeLessThanOrEqual(9);
    expect(writes).toBeGreaterThanOrEqual(7);
  });

  it("publishes the last sample of a burst on the trailing edge", () => {
    useVideoStore.getState().recordG2GSample(100);
    useVideoStore.getState().recordG2GSample(300);
    expect(useVideoStore.getState().latency.trueG2GMs).toBe(100);
    vi.advanceTimersByTime(G2G_PUBLISH_INTERVAL_MS);
    expect(useVideoStore.getState().latency.trueG2GMs).toBe(200);
  });

  it("drops a pending publish on reset", () => {
    useVideoStore.getState().recordG2GSample(100);
    useVideoStore.getState().recordG2GSample(300);
    useVideoStore.getState().resetLatency();
    vi.advanceTimersByTime(G2G_PUBLISH_INTERVAL_MS);
    expect(useVideoStore.getState().latency.trueG2GMs).toBeNull();
  });
});
