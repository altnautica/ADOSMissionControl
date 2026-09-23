import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import { VisionPipelinesPanel } from "@/components/vision/VisionPipelinesPanel";
import {
  useVisionDetectionsStore,
  type VisionDetection,
} from "@/stores/vision-detections-store";
import messages from "../../../../locales/en.json";

const DRONE = "node:d1";

function renderPanel(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function seed(
  modelId: string,
  cameraId: string,
  detections: VisionDetection[] = [],
) {
  useVisionDetectionsStore.getState().setBatch(DRONE, {
    modelId,
    cameraId,
    frameId: 1,
    tsMs: 0,
    frameWidth: 1280,
    frameHeight: 720,
    detections,
  });
}

describe("VisionPipelinesPanel", () => {
  beforeEach(() => useVisionDetectionsStore.getState().clear());
  afterEach(cleanup);

  it("renders a row per active pipeline stream", () => {
    seed("person", "uvc-0", [
      {
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        classLabel: "person",
        confidence: 0.9,
        trackId: 7,
        lockState: "locked",
      },
    ]);
    seed("depth", "uvc-1", []);
    renderPanel(<VisionPipelinesPanel droneId={DRONE} />);
    expect(screen.getAllByTestId("vision-pipeline-row")).toHaveLength(2);
  });

  it("fires onSelect with the stream key when a row is clicked", () => {
    seed("person", "uvc-0");
    const onSelect = vi.fn();
    renderPanel(
      <VisionPipelinesPanel
        droneId={DRONE}
        selectedKey={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("vision-pipeline-row"));
    expect(onSelect).toHaveBeenCalledWith("person::uvc-0");
  });

  it("marks the selected stream row", () => {
    seed("person", "uvc-0");
    seed("depth", "uvc-1");
    renderPanel(
      <VisionPipelinesPanel
        droneId={DRONE}
        selectedKey="depth::uvc-1"
        onSelect={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId("vision-pipeline-row");
    const selected = rows.filter(
      (r) => r.getAttribute("data-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-active")).toBe("true");
  });

  it("rows are read-only when no onSelect is given", () => {
    seed("person", "uvc-0");
    renderPanel(<VisionPipelinesPanel droneId={DRONE} />);
    const row = screen.getByTestId("vision-pipeline-row");
    expect(row.getAttribute("role")).toBeNull();
  });
  it("flips a stream that stopped publishing to stalled while another keeps going", () => {
    vi.useFakeTimers();
    try {
      seed("person", "uvc-0");
      seed("person", "uvc-1");
      renderPanel(<VisionPipelinesPanel droneId={DRONE} />);
      // Only uvc-0 keeps publishing, at 10 Hz, for 3 s.
      for (let i = 0; i < 30; i++) {
        act(() => {
          vi.advanceTimersByTime(100);
          seed("person", "uvc-0");
        });
      }
      // Rows are sorted by stream key: person::uvc-0, then person::uvc-1.
      const rows = screen.getAllByTestId("vision-pipeline-row");
      expect(rows.map((r) => r.getAttribute("data-active"))).toEqual(["true", "false"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the engine status is unavailable, not 'no pipelines', with no read-back", () => {
    renderPanel(<VisionPipelinesPanel droneId={DRONE} />);
    expect(screen.queryByText(messages.vision.noPipelines)).toBeNull();
    expect(screen.getByText(messages.vision.engineStatusUnavailable)).toBeTruthy();
  });
});
