/**
 * Tests for the demo-mode synthetic vision-detection generator: it pushes
 * well-formed, in-frame detection batches into the vision-detections store at
 * inference cadence, retargets onto a new drone, walks the scripted HUD cycle
 * (designation, follow events, nav feed) and cleans up on stop.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockDetectionStream } from "@/mock/mock-detections";
import { mockPilot } from "@/mock/mock-pilot";
import { REACQUIRED_TRACK, TARGET_TRACK } from "@/mock/mock-hud-script";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

describe("mock detection stream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useVisionDetectionsStore.getState().clear();
    useSelectedTargetStore.getState().reset();
  });

  afterEach(() => {
    mockDetectionStream.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function batch(id = "drone-1") {
    return useVisionDetectionsStore.getState().batches[id];
  }

  it("pushes a batch for the target drone on the first tick", () => {
    mockDetectionStream.start("drone-1");
    vi.advanceTimersByTime(100);
    expect(batch()).toBeDefined();
    expect(batch().frameWidth).toBe(640);
    expect(batch().frameHeight).toBe(480);
    expect(batch().detections.length).toBeGreaterThanOrEqual(3);
  });

  it("produces in-frame boxes with sane confidences", () => {
    mockDetectionStream.start("drone-1");
    for (let i = 0; i < 46; i++) {
      vi.advanceTimersByTime(700);
      for (const d of batch().detections) {
        expect(d.bbox).toBeDefined();
        if (!d.bbox) continue;
        expect(d.bbox.x).toBeGreaterThanOrEqual(0);
        expect(d.bbox.y).toBeGreaterThanOrEqual(0);
        expect(d.bbox.x + d.bbox.width).toBeLessThanOrEqual(640);
        expect(d.bbox.y + d.bbox.height).toBeLessThanOrEqual(480);
        expect(d.confidence).toBeGreaterThan(0);
        expect(d.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it("advances the frame id across ticks", () => {
    mockDetectionStream.start("drone-1");
    vi.advanceTimersByTime(100);
    const first = batch().frameId;
    vi.advanceTimersByTime(100);
    expect(batch().frameId).toBeGreaterThan(first);
  });

  it("boxes drift between ticks (the track moves)", () => {
    mockDetectionStream.start("drone-1");
    vi.advanceTimersByTime(100);
    const a = batch().detections[0].bbox;
    vi.advanceTimersByTime(2000);
    const b = batch().detections[0].bbox;
    expect(a?.x !== b?.x || a?.y !== b?.y).toBe(true);
  });

  it("retargets onto a new drone and stops feeding the old one", () => {
    mockDetectionStream.start("drone-1");
    vi.advanceTimersByTime(100);
    expect(batch("drone-1")).toBeDefined();

    mockDetectionStream.start("drone-2");
    vi.advanceTimersByTime(100);
    expect(batch("drone-1")).toBeUndefined();
    expect(useNavStreamStore.getState().byDrone["drone-1"]).toBeUndefined();
    expect(batch("drone-2")).toBeDefined();
  });

  it("clears the batch, the nav feed and stops ticking on stop()", () => {
    mockDetectionStream.start("drone-1");
    vi.advanceTimersByTime(1000);
    expect(useNavStreamStore.getState().byDrone["drone-1"]?.pose).toBeDefined();
    mockDetectionStream.stop();
    expect(batch("drone-1")).toBeUndefined();
    expect(useNavStreamStore.getState().byDrone["drone-1"]).toBeUndefined();
    expect(mockDetectionStream.isRunning()).toBe(false);

    vi.advanceTimersByTime(500);
    expect(batch("drone-1")).toBeUndefined();
  });

  it("designates, re-designates and releases along the scripted cycle", () => {
    // The demo designates only while its pilot flies the Follow-Me skill.
    vi.spyOn(mockPilot, "followSkillActive").mockReturnValue(true);
    mockDetectionStream.start("drone-1");
    vi.advanceTimersByTime(8_100);
    let designated = useSelectedTargetStore.getState().designated;
    expect(designated?.trackId).toBe(TARGET_TRACK);
    expect(designated?.droneId).toBe("drone-1");
    expect(designated?.cameraId).toBe(batch().cameraId);

    vi.advanceTimersByTime(16_000); // 24.1 s: re-acquired
    designated = useSelectedTargetStore.getState().designated;
    expect(designated?.trackId).toBe(REACQUIRED_TRACK);
    const event = useNavStreamStore.getState().byDrone["drone-1"]?.followEvent?.data;
    expect(event).toEqual({ topic: "follow.reacquired", trackId: 15, similarity: 0.86, gapS: 1.8 });

    vi.advanceTimersByTime(4_000); // 28.1 s: lost
    expect(useNavStreamStore.getState().byDrone["drone-1"]?.followEvent?.data.topic).toBe("follow.lost");
    expect(useNavStreamStore.getState().byDrone["drone-1"]?.follow?.data.phase).toBe("lost");

    vi.advanceTimersByTime(4_000); // 32.1 s: loop restarts
    expect(useSelectedTargetStore.getState().designated).toBeNull();
  });

  it("releases its designation on stop", () => {
    // The demo designates only while its pilot flies the Follow-Me skill.
    vi.spyOn(mockPilot, "followSkillActive").mockReturnValue(true);
    mockDetectionStream.start("drone-1");
    vi.advanceTimersByTime(8_100);
    expect(useSelectedTargetStore.getState().designated).not.toBeNull();
    mockDetectionStream.stop();
    expect(useSelectedTargetStore.getState().designated).toBeNull();
  });
});
