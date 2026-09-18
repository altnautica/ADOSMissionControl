/**
 * Detection boxes must land on the video, not on the pane.
 *
 * The video renders `object-contain`, so a 16:9 stream in a 4:3 pane paints
 * into a letterboxed sub-rectangle with dead bars above and below. The
 * overlay used to position boxes as percentages of the whole pane, which
 * stretched every box across the bars and offset it from the thing it was
 * drawn around — on a targeting surface, a box pointing at the wrong place.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { DetectionOverlay } from "@/components/vision/DetectionOverlay";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const PANE_W = 800;
const PANE_H = 600; // 4:3 pane
const FRAME_W = 1920;
const FRAME_H = 1080; // 16:9 stream

/** `object-contain` of 16:9 into 4:3: full width, 450 px tall, 75 px bars. */
const RENDERED_H = (PANE_W * FRAME_H) / FRAME_W; // 450
const BAR = (PANE_H - RENDERED_H) / 2; // 75

function sizePane() {
  // jsdom reports 0 for every layout box, so the overlay's ResizeObserver
  // measurement has to come from stubbed clientWidth/clientHeight.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(PANE_W);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
    PANE_H,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
}

function publishBatch() {
  useVisionDetectionsStore.setState({
    batches: {
      "drone-1": {
        cameraId: "cam0",
        modelId: "yolov8n",
        tsMs: Date.now(),
        frameId: 1,
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
        receivedAt: Date.now(),
        detections: [
          {
            // Dead centre of the frame, a quarter of it wide and tall.
            bbox: {
              x: FRAME_W * 0.375,
              y: FRAME_H * 0.375,
              width: FRAME_W * 0.25,
              height: FRAME_H * 0.25,
            },
            classLabel: "person",
            confidence: 0.9,
          },
        ],
      },
    },
    streams: {},
  });
}

describe("DetectionOverlay geometry", () => {
  beforeEach(() => {
    sizePane();
    publishBatch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useVisionDetectionsStore.setState({ batches: {}, streams: {} });
  });

  it("places a box inside the letterboxed video rect, not the pane", () => {
    render(<DetectionOverlay droneId="drone-1" />);

    const box = screen.getByText(/person/).parentElement!;
    const style = box.style;

    // Centre of a 16:9 frame letterboxed into a 4:3 pane.
    expect(parseFloat(style.left)).toBeCloseTo(PANE_W * 0.375, 1);
    expect(parseFloat(style.width)).toBeCloseTo(PANE_W * 0.25, 1);

    // The vertical axis is the one the old percentage maths got wrong: it
    // must be offset by the letterbox bar and scaled to the video height,
    // not to the pane height.
    expect(parseFloat(style.top)).toBeCloseTo(BAR + RENDERED_H * 0.375, 1);
    expect(parseFloat(style.height)).toBeCloseTo(RENDERED_H * 0.25, 1);

    // Sanity: the pane-relative answer (which is what shipped) is a
    // materially different, wrong place.
    expect(parseFloat(style.top)).not.toBeCloseTo(PANE_H * 0.375, 1);
  });

  it("drops boxes once the batch goes stale", () => {
    useVisionDetectionsStore.setState((s) => ({
      batches: {
        "drone-1": {
          ...s.batches["drone-1"]!,
          receivedAt: Date.now() - 60_000,
        },
      },
    }));
    render(<DetectionOverlay droneId="drone-1" />);
    expect(screen.queryByText(/person/)).toBeNull();
  });
});
