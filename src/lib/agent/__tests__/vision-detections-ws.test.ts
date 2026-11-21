/**
 * @module vision-detections-ws.test
 * @description Unit tests for the wire → store mapping of the live
 * detection feed: snake_case contract fields onto the store's camelCase
 * shape, defaulting frame dimensions to the engine's normalized size when
 * the wire batch omits them, and dropping a batch whose wire `v` version is
 * one this GCS does not speak.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { mapWireBatch } from "../vision-detections-ws";
import { CONTRACT_VERSIONS } from "@/lib/plugins/contracts.generated";
import type { VisionDetectionBatch } from "@/stores/vision-detections-store";

/** The detection wire version this GCS speaks (the agent's contract registry). */
const WIRE_V = CONTRACT_VERSIONS["vision.detection"];

/** Narrow the now-nullable `mapWireBatch` result for the known-good batches
 * these mapping tests build (they omit `v` or carry the supported one). */
function must(
  b: Omit<VisionDetectionBatch, "receivedAt"> | null,
): Omit<VisionDetectionBatch, "receivedAt"> {
  if (!b) throw new Error("expected a mapped batch, got null");
  return b;
}

describe("mapWireBatch", () => {
  it("maps a full batch onto the camelCase store shape", () => {
    const batch = must(
      mapWireBatch({
        model_id: "com.example.weeds",
        camera_id: "uvc-0",
        frame_id: 7,
        // v3: the agent's host-monotonic frame time (ms since its boot).
        ts_ms: 3_725_412,
        detections: [
          {
            bbox: { x: 12, y: 20, width: 64, height: 32 },
            class_label: "weed",
            confidence: 0.87,
            track_id: 3,
            assoc_confidence: 0.71,
            lock_state: "locked",
          },
        ],
      }),
    );
    expect(batch.modelId).toBe("com.example.weeds");
    expect(batch.cameraId).toBe("uvc-0");
    expect(batch.frameId).toBe(7);
    expect(batch.tsMs).toBe(3_725_412);
    // No frame dims on the wire → engine normalized default.
    expect(batch.frameWidth).toBe(640);
    expect(batch.frameHeight).toBe(480);
    expect(batch.detections).toHaveLength(1);
    const d = batch.detections[0];
    expect(d.classLabel).toBe("weed");
    expect(d.confidence).toBeCloseTo(0.87);
    expect(d.trackId).toBe(3);
    expect(d.assocConfidence).toBeCloseTo(0.71);
    expect(d.lockState).toBe("locked");
    expect(d.bbox).toEqual({ x: 12, y: 20, width: 64, height: 32 });
  });

  it("defaults the lock fields to null when the agent omits them", () => {
    const batch = must(
      mapWireBatch({
        model_id: "m",
        camera_id: "c",
        frame_id: 1,
        ts_ms: 0,
        detections: [
          {
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            class_label: "x",
            confidence: 0.5,
            track_id: 9,
          },
        ],
      }),
    );
    expect(batch.detections[0].assocConfidence).toBeNull();
    expect(batch.detections[0].lockState).toBeNull();
  });

  it("maps the uncertain lock state and rejects an unknown one", () => {
    const ok = must(
      mapWireBatch({
        model_id: "m",
        camera_id: "c",
        frame_id: 1,
        ts_ms: 0,
        detections: [
          {
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            class_label: "x",
            confidence: 0.5,
            lock_state: "uncertain",
          },
          {
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            class_label: "x",
            confidence: 0.5,
            lock_state: "garbage",
          },
        ],
      } as never),
    );
    expect(ok.detections[0].lockState).toBe("uncertain");
    // An unrecognized state coerces to null, never a bad enum value.
    expect(ok.detections[1].lockState).toBeNull();
  });

  it("uses explicit frame dimensions when the agent advertises them", () => {
    const batch = must(
      mapWireBatch({
        model_id: "m",
        camera_id: "c",
        frame_id: 1,
        ts_ms: 0,
        frame_width: 1280,
        frame_height: 720,
        detections: [],
      }),
    );
    expect(batch.frameWidth).toBe(1280);
    expect(batch.frameHeight).toBe(720);
    expect(batch.detections).toEqual([]);
  });

  it("defaults a missing track_id to null", () => {
    const batch = must(
      mapWireBatch({
        model_id: "m",
        camera_id: "c",
        frame_id: 1,
        ts_ms: 0,
        detections: [
          {
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            class_label: "x",
            confidence: 0.5,
          },
        ],
      }),
    );
    expect(batch.detections[0].trackId).toBeNull();
  });

  it("tolerates malformed entries without throwing", () => {
    const batch = must(
      mapWireBatch({
        detections: [null, 42, { bbox: {}, class_label: "y", confidence: "bad" }],
      } as never),
    );
    // Non-object entries dropped; the one object survives with coerced fields.
    expect(batch.detections).toHaveLength(1);
    expect(batch.detections[0].classLabel).toBe("y");
    expect(batch.detections[0].confidence).toBe(0);
    expect(batch.detections[0].bbox).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(batch.modelId).toBe("");
    expect(batch.frameWidth).toBe(640);
  });
});

describe("mapWireBatch wire-version gate (A7)", () => {
  it("maps a batch stamped with the current wire version", () => {
    const batch = mapWireBatch({
      v: WIRE_V,
      model_id: "m",
      camera_id: "c",
      frame_id: 4,
      ts_ms: 0,
      detections: [],
    });
    expect(batch).not.toBeNull();
    expect(batch?.modelId).toBe("m");
    expect(batch?.frameId).toBe(4);
  });

  it("drops a batch stamped with an unsupported wire version", () => {
    const batch = mapWireBatch({
      // A future version that may have reshaped fields — never mis-map it.
      v: 99,
      model_id: "m",
      camera_id: "c",
      frame_id: 1,
      ts_ms: 0,
      detections: [
        {
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          class_label: "x",
          confidence: 0.5,
        },
      ],
    });
    expect(batch).toBeNull();
  });

  it("maps a batch that omits `v` (back-compat with a pre-version agent)", () => {
    const batch = mapWireBatch({
      model_id: "m",
      camera_id: "c",
      frame_id: 1,
      ts_ms: 0,
      detections: [],
    });
    expect(batch).not.toBeNull();
  });
});

describe("mapWireBatch typed percept fields", () => {
  it("maps mask, keypoints, depth, and world position off the wire", () => {
    const batch = mapWireBatch({
      v: WIRE_V,
      model_id: "m",
      camera_id: "c",
      frame_id: 1,
      ts_ms: 0,
      frame_width: 1280,
      frame_height: 720,
      detections: [
        {
          bbox: { x: 10, y: 12, width: 30, height: 40 },
          class_label: "person",
          confidence: 0.9,
          mask: [
            [10, 12],
            [40, 12],
            [40, 52],
          ],
          keypoints: [{ x: 25, y: 18, confidence: 0.9 }],
          depth: 4.5,
          world_pos: [12.5, -3, 1.2],
        },
      ],
    });
    expect(batch).not.toBeNull();
    const d = batch?.detections[0];
    expect(d?.mask).toEqual([
      [10, 12],
      [40, 12],
      [40, 52],
    ]);
    expect(d?.keypoints).toEqual([{ x: 25, y: 18, confidence: 0.9 }]);
    expect(d?.depth).toBe(4.5);
    expect(d?.worldPos).toEqual([12.5, -3, 1.2]);
  });

  it("maps a box-less percept to an absent bbox", () => {
    const batch = mapWireBatch({
      v: WIRE_V,
      model_id: "m",
      camera_id: "c",
      frame_id: 1,
      ts_ms: 0,
      detections: [
        {
          class_label: "region",
          confidence: 0.5,
          mask: [
            [0, 0],
            [100, 0],
            [50, 100],
          ],
        },
      ],
    });
    expect(batch).not.toBeNull();
    const d = batch?.detections[0];
    expect(d?.bbox).toBeUndefined();
    expect(d?.mask).toEqual([
      [0, 0],
      [100, 0],
      [50, 100],
    ]);
  });
});
