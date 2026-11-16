import { beforeEach, describe, expect, it } from "vitest";

import { ingestWireBatch } from "@/lib/agent/vision-detections-ws";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const box = (x: number, y: number) => ({ x, y, width: 20, height: 40 });
interface Det {
  bbox: { x: number; y: number; width: number; height: number };
  class_label: string;
  confidence: number;
  track_id: number;
}
const det = (trackId: number, x: number, y: number): Det => ({
  bbox: box(x, y),
  class_label: "person",
  confidence: 0.9,
  track_id: trackId,
});
const CROP = { x: 200, y: 100, width: 200, height: 200 };

function ids(): number[] {
  const b = useVisionDetectionsStore.getState().batches.d1;
  return (b?.detections ?? []).map((d) => d.trackId ?? -1).sort((a, z) => a - z);
}

function feed(tsMs: number, dets: Det[], crop?: typeof CROP) {
  ingestWireBatch("d1", {
    model_id: "m",
    camera_id: "c",
    frame_id: tsMs,
    ts_ms: tsMs,
    detections: dets,
    ...(crop ? { crop_window: crop } : {}),
  });
}

describe("crop-only detection batches", () => {
  beforeEach(() => useVisionDetectionsStore.getState().clear());

  it("keep the whole frame's boxes outside the window until the next whole frame", () => {
    // 1 is the subject inside the window; 2 and 3 are people outside it.
    feed(1000, [det(1, 280, 180), det(2, 20, 20), det(3, 500, 300)]);
    feed(1100, [det(1, 285, 180)], CROP);
    expect(ids()).toEqual([1, 2, 3]);
    const b = useVisionDetectionsStore.getState().batches.d1;
    expect(b.detections.filter((d) => d.held).map((d) => d.trackId)).toEqual([2, 3]);
    // A whole-frame batch replaces the held boxes.
    feed(1200, [det(1, 290, 180), det(3, 505, 300)]);
    expect(ids()).toEqual([1, 3]);
  });

  it("drop a held box whose track the crop batch carries, and boxes inside the window", () => {
    feed(1000, [det(1, 280, 180), det(4, 250, 150), det(2, 20, 20)]);
    feed(1100, [det(1, 285, 180), det(2, 210, 110)], CROP);
    // 4 was inside the window and not re-detected; 2 now comes from the crop.
    expect(ids()).toEqual([1, 2]);
  });

  it("let held boxes lapse a second after their whole frame", () => {
    feed(1000, [det(1, 280, 180), det(2, 20, 20)]);
    feed(1900, [det(1, 285, 180)], CROP);
    expect(ids()).toEqual([1, 2]);
    feed(2100, [det(1, 285, 180)], CROP);
    expect(ids()).toEqual([1]);
  });

  it("draw a batch without the field as it is", () => {
    feed(1000, [det(1, 280, 180), det(2, 20, 20)]);
    feed(1100, [det(1, 285, 180)]);
    expect(ids()).toEqual([1]);
  });
});
