import { describe, expect, it } from "vitest";

import { pickActiveLegBatch } from "@/components/cockpit/VideoOverlayHost";
import type { VisionDetectionBatch } from "@/stores/vision-detections-store";

function batch(cameraId: string, receivedAt: number): VisionDetectionBatch {
  return {
    modelId: "m",
    cameraId,
    frameId: 1,
    tsMs: 0,
    frameWidth: 640,
    frameHeight: 480,
    detections: [],
    receivedAt,
  };
}

describe("pickActiveLegBatch", () => {
  it("single-stream node uses the latest batch regardless of cameraId", () => {
    const latest = batch("some-device", 10);
    expect(pickActiveLegBatch(false, latest, undefined, null)).toBe(latest);
    expect(pickActiveLegBatch(false, latest, undefined, "unrelated")).toBe(
      latest,
    );
  });

  it("multi-stream node draws only the ACTIVE leg's batch", () => {
    const eo = batch("eo", 20);
    const ir = batch("ir", 30);
    const perStream = { "m::eo": eo, "m::ir": ir };
    // Active leg is EO → the IR batch (newer) must NOT be drawn.
    expect(pickActiveLegBatch(true, ir, perStream, "eo")).toBe(eo);
    // Active leg is IR → its own batch is drawn.
    expect(pickActiveLegBatch(true, ir, perStream, "ir")).toBe(ir);
  });

  it("multi-stream node draws nothing when the active leg has no detections", () => {
    const eo = batch("eo", 20);
    const perStream = { "m::eo": eo };
    // Active leg is IR, only EO is reporting → no boxes (not EO's over IR).
    expect(pickActiveLegBatch(true, eo, perStream, "ir")).toBeUndefined();
  });

  it("multi-stream picks the newest batch of the active leg (several models)", () => {
    const older = batch("eo", 20);
    const newer = batch("eo", 40);
    const perStream = { "a::eo": older, "b::eo": newer };
    expect(pickActiveLegBatch(true, newer, perStream, "eo")).toBe(newer);
  });
});
