import { act, cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../locales/en.json";
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

function renderOverlay() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DetectionOverlay droneId={DRONE} />
    </NextIntlClientProvider>,
  );
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
    // A 4:3 pane the size of the frame, so tags are laid out.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
    useVisionDetectionsStore.getState().clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("draws only the active stream's camera boxes", () => {
    showLegs(["a", "b"], "b");
    const { container } = renderOverlay();
    push("b", "bravo");
    push("a", "alpha");
    expect(container.textContent).toContain("BRAVO");
    expect(container.textContent).not.toContain("ALPHA");
  });

  it("draws nothing when the active camera has no batch", () => {
    showLegs(["a", "b"], "b");
    const { container } = renderOverlay();
    push("a", "alpha");
    expect(container.textContent).toBe("");
  });

  it("never paints another camera's boxes behind a single leg", () => {
    showLegs(["b"], "b");
    const { container } = renderOverlay();
    push("b", "bravo");
    push("a", "alpha");
    expect(container.textContent).toContain("BRAVO");
    expect(container.textContent).not.toContain("ALPHA");
  });
});
