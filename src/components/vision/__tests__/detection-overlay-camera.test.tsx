import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DetectionOverlay } from "@/components/vision/DetectionOverlay";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const DRONE = "node:d1";

function push(cameraId: string, label: string) {
  act(() => {
    useVisionDetectionsStore.getState().setBatch(DRONE, {
      modelId: "m",
      cameraId,
      frameId: 1,
      tsMs: 1,
      frameWidth: 640,
      frameHeight: 480,
      detections: [
        {
          bbox: { x: 100, y: 100, width: 40, height: 80 },
          classLabel: label,
          confidence: 0.9,
        },
      ],
    });
  });
}

function showLegs(ids: string[], active: string) {
  useVideoStreamsStore.setState({
    streamsByDrone: {
      [DRONE]: ids.map((id, i) => ({ id, index: i + 1, label: id, kind: "concurrent" as const })),
    },
    activeStreamIdByDrone: { [DRONE]: active },
  });
}

describe("DetectionOverlay camera pinning", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  beforeEach(() => {
    useVisionDetectionsStore.getState().clear();
  });
  afterEach(() => cleanup());

  it("draws only the active stream's camera boxes", () => {
    showLegs(["a", "b"], "b");
    const { container } = render(<DetectionOverlay droneId={DRONE} />);
    push("b", "bravo");
    push("a", "alpha");
    expect(container.textContent).toContain("bravo");
    expect(container.textContent).not.toContain("alpha");
  });

  it("draws nothing when the active camera has no batch", () => {
    showLegs(["a", "b"], "b");
    const { container } = render(<DetectionOverlay droneId={DRONE} />);
    push("a", "alpha");
    expect(container.textContent).toBe("");
  });

  it("never paints another camera's boxes behind a single leg", () => {
    showLegs(["b"], "b");
    const { container } = render(<DetectionOverlay droneId={DRONE} />);
    push("b", "bravo");
    push("a", "alpha");
    expect(container.textContent).toContain("bravo");
    expect(container.textContent).not.toContain("alpha");
  });
});
