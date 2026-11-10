/**
 * @module mock-detections-vision-off.test
 * @description The demo detection stream models one drone whose vision
 * engine is not running: it records the agent's `available:false` report
 * instead of pushing batches, and stopping the stream clears it. The same
 * drone's seeded capabilities report the engine off with no active model, so
 * the Vision tab's summary card agrees with the vision-off chip.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockDetectionStream, VISION_OFF_DEMO_DRONE } from "@/mock/mock-detections";
import { seedFocusedCapabilities } from "@/mock/demo-seed/agent-focus";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

describe("mockDetectionStream vision-off drone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useVisionDetectionsStore.getState().clear();
  });
  afterEach(() => {
    mockDetectionStream.stop();
    vi.useRealTimers();
  });

  it("flags the vision-off demo drone and pushes no batches", () => {
    const id = nodeIdForDevice(VISION_OFF_DEMO_DRONE);
    mockDetectionStream.start(id);
    vi.advanceTimersByTime(500);
    const state = useVisionDetectionsStore.getState();
    expect(state.visionUnavailable[id]).toBe(true);
    expect(state.batches[id]).toBeUndefined();
    mockDetectionStream.stop();
    expect(id in useVisionDetectionsStore.getState().visionUnavailable).toBe(false);
  });

  it("streams batches for any other demo drone", () => {
    const id = nodeIdForDevice("alpha-1");
    mockDetectionStream.start(id);
    vi.advanceTimersByTime(250);
    const state = useVisionDetectionsStore.getState();
    expect(state.batches[id]).toBeDefined();
    expect(id in state.visionUnavailable).toBe(false);
  });
});

describe("vision-off demo drone capabilities", () => {
  function seedFor(deviceId: string) {
    useDroneManager.setState({ selectedDroneId: nodeIdForDevice(deviceId) });
    seedFocusedCapabilities();
    return useAgentCapabilitiesStore.getState().byDevice[deviceId];
  }

  it("reports the engine off with no active model, agreeing with the chip", () => {
    const caps = seedFor(VISION_OFF_DEMO_DRONE);
    expect(caps).toBeDefined();
    expect(caps.vision.engine_state).toBe("off");
    expect(caps.vision.model_loaded).toBeNull();
    // VisionSummaryCard reads "active" only when the summary names a model.
    expect(caps.visionSummary?.activeModel ?? null).toBeNull();
    expect(caps.models.installed.some((m) => m.loaded)).toBe(false);
  });

  it("keeps the engine active on a demo drone whose stream is live", () => {
    const caps = seedFor("alpha-1");
    expect(caps.vision.engine_state).toBe("active");
    expect(caps.visionSummary?.activeModel).toBe("person_v1_small");
  });
});
