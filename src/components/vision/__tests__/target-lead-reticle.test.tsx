import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TargetLeadReticle } from "@/components/vision/TargetLeadReticle";
import { useCockpitMarksStore } from "@/stores/cockpit-marks-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import {
  DETECTION_STALE_MS,
  useVisionDetectionsStore,
} from "@/stores/vision-detections-store";

const DRONE = "node:d1";

function push(x: number, cameraId = "cam0") {
  act(() => {
    useVisionDetectionsStore.getState().setBatch(DRONE, {
      modelId: "m",
      cameraId,
      frameId: x,
      tsMs: x,
      frameWidth: 640,
      frameHeight: 480,
      detections: [
        {
          bbox: { x, y: 100, width: 40, height: 80 },
          classLabel: "person",
          confidence: 0.9,
          trackId: 7,
          lockState: "locked",
        },
      ],
    });
  });
}

const hasLead = () => useCockpitMarksStore.getState().bySource.has("builtin.target-lead");

describe("TargetLeadReticle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useVisionDetectionsStore.getState().clear();
    useCockpitMarksStore.setState({ bySource: new Map() });
    useSelectedTargetStore.setState({
      popupTarget: null,
      designated: {
        droneId: DRONE,
        cameraId: "cam0",
        trackId: 7,
        bbox: { x: 100, y: 100, width: 40, height: 80 },
        classLabel: "person",
        confidence: 0.9,
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("draws a lead for a moving designated target and drops it once the feed goes stale", () => {
    render(<TargetLeadReticle droneId={DRONE} />);
    push(100);
    vi.advanceTimersByTime(100);
    push(140);
    expect(hasLead()).toBe(true);

    // The feed stops: no further batch ever arrives.
    act(() => {
      vi.advanceTimersByTime(DETECTION_STALE_MS + 10);
    });
    expect(hasLead()).toBe(false);
  });

  it("draws no lead for a target designated on a camera the video does not show", () => {
    useSelectedTargetStore.setState((s) => ({
      designated: s.designated && { ...s.designated, cameraId: "cam1" },
    }));
    render(<TargetLeadReticle droneId={DRONE} />);
    push(100);
    vi.advanceTimersByTime(100);
    push(140);
    expect(hasLead()).toBe(false);
  });
});
