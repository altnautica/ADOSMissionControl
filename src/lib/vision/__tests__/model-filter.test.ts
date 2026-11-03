import { describe, it, expect } from "vitest";

import {
  filterModelsForBoard,
  type BoardComputeFacts,
} from "@/lib/vision/model-filter";
import type { VisionModelsResponse } from "@/lib/agent/vision-client";

function models(
  over: Partial<VisionModelsResponse> = {},
): VisionModelsResponse {
  return {
    registry: [],
    installed: [],
    custom: [],
    active: null,
    cache: { usedBytes: 0, maxBytes: 0, usedMb: 0, maxMb: 0 },
    ...over,
  };
}

const PI4B: BoardComputeFacts = {
  soc: "BCM2711",
  boardId: "rpi4b",
  boardName: "Raspberry Pi 4B",
  arch: "aarch64",
  npuRuntime: null,
  npuTops: 0,
};

const RK3588: BoardComputeFacts = {
  soc: "RK3588S2",
  boardId: "rock-5c-lite",
  boardName: "Radxa ROCK 5C Lite",
  arch: "aarch64",
  npuRuntime: "rknn",
  npuTops: 6,
};

describe("filterModelsForBoard", () => {
  it("returns an empty list for no models", () => {
    expect(filterModelsForBoard(models(), PI4B)).toEqual([]);
  });

  it("keeps a CPU/ONNX registry model on a no-NPU Pi 4B and marks it fit", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "yolov8n-onnx-320",
            name: "YOLOv8n 320 INT8",
            description: "CPU detector",
            task: "detection",
            variants: [
              { runtime: "onnx", min_tops: 0, board_match: ["rpi4b"] },
            ],
          },
        ],
      }),
      PI4B,
    );
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("yolov8n-onnx-320");
    expect(res[0].fits).toBe(true);
    expect(res[0].fitReason).toBeNull();
    expect(res[0].sources).toEqual(["registry"]);
  });

  it("flags an NPU-only (rknn) registry model as not fit on a no-NPU board, but still lists it", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "yolov8n-rknn",
            name: "YOLOv8n RKNN",
            description: "NPU detector",
            task: "detection",
            variants: [{ runtime: "rknn", min_tops: 3, board_match: [] }],
          },
        ],
      }),
      PI4B,
    );
    expect(res).toHaveLength(1);
    expect(res[0].fits).toBe(false);
    expect(res[0].fitReason).toBe("needs_npu");
  });

  it("accepts the rknn model on an RK3588 NPU board with enough TOPS", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "yolov8n-rknn",
            name: "YOLOv8n RKNN",
            description: "NPU detector",
            task: "detection",
            variants: [{ runtime: "rknn", min_tops: 3, board_match: [] }],
          },
        ],
      }),
      RK3588,
    );
    expect(res[0].fits).toBe(true);
    expect(res[0].fitReason).toBeNull();
  });

  it("rejects an rknn model that needs more TOPS than the board has", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "big-rknn",
            name: "Big RKNN",
            description: "",
            task: "detection",
            variants: [{ runtime: "rknn", min_tops: 12, board_match: [] }],
          },
        ],
      }),
      RK3588,
    );
    expect(res[0].fits).toBe(false);
    expect(res[0].fitReason).toBe("insufficient_tops");
  });

  it("picks any fitting variant when one variant fits the board", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "multi",
            name: "Multi variant",
            description: "",
            task: "detection",
            variants: [
              { runtime: "rknn", min_tops: 3, board_match: [] },
              { runtime: "onnx", min_tops: 0, board_match: ["rpi4b"] },
            ],
          },
        ],
      }),
      PI4B,
    );
    // The onnx/0-tops variant fits → the whole model fits on the Pi.
    expect(res[0].fits).toBe(true);
    expect(res[0].fitReason).toBeNull();
  });

  it("flags a board_mismatch when no variant matches the SoC", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "jetson-only",
            name: "Jetson only",
            description: "",
            task: "detection",
            variants: [
              { runtime: "tensorrt", min_tops: 0, board_match: ["jetson-orin"] },
            ],
          },
        ],
      }),
      PI4B,
    );
    expect(res[0].fits).toBe(false);
    expect(res[0].fitReason).toBe("board_mismatch");
  });

  it("merges an installed registry model and flags installed + active", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "yolov8n-onnx-320",
            name: "YOLOv8n",
            description: "",
            task: "detection",
            variants: [{ runtime: "onnx", min_tops: 0, board_match: [] }],
          },
        ],
        installed: [
          {
            id: "yolov8n-onnx-320",
            filename: "yolov8n.onnx",
            sizeBytes: 1000,
            format: "onnx",
          },
        ],
        active: "yolov8n-onnx-320",
      }),
      PI4B,
    );
    expect(res).toHaveLength(1);
    expect(res[0].installed).toBe(true);
    expect(res[0].active).toBe(true);
  });

  it("lists an installed-only model that is not in the registry", () => {
    const res = filterModelsForBoard(
      models({
        installed: [
          {
            id: "orphan",
            filename: "orphan.onnx",
            sizeBytes: 1,
            format: "onnx",
          },
        ],
      }),
      PI4B,
    );
    expect(res).toHaveLength(1);
    expect(res[0].sources).toEqual(["installed"]);
    expect(res[0].installed).toBe(true);
  });

  it("lists a custom upload, fit by its onnx runtime on a Pi 4B", () => {
    const res = filterModelsForBoard(
      models({
        custom: [
          {
            id: "my-uploaded",
            name: "My uploaded model",
            filename: "u.onnx",
            sizeBytes: 1,
            format: "onnx",
            head: "yolov8",
            runtime: "onnx",
            classes: ["person", "car"],
            inputWidth: 320,
            inputHeight: 320,
            boardMatch: [],
            verified: true,
          },
        ],
      }),
      PI4B,
    );
    expect(res).toHaveLength(1);
    expect(res[0].custom).toBe(true);
    expect(res[0].fits).toBe(true);
    expect(res[0].customMeta?.classes).toEqual(["person", "car"]);
  });

  it("flags a custom rknn upload as needing an NPU on a Pi 4B", () => {
    const res = filterModelsForBoard(
      models({
        custom: [
          {
            id: "custom-rknn",
            name: "Custom RKNN",
            filename: "c.rknn",
            sizeBytes: 1,
            format: "rknn",
            head: "yolov8",
            runtime: "rknn",
            classes: ["person"],
            inputWidth: 640,
            inputHeight: 640,
            boardMatch: [],
            verified: false,
          },
        ],
      }),
      PI4B,
    );
    expect(res[0].fits).toBe(false);
    expect(res[0].fitReason).toBe("needs_npu");
  });

  it("keeps the Pi-4B CPU/ONNX 320 INT8 variant fit on a no-NPU Pi 4B (array board_match)", () => {
    // A catalog entry shaped like a detector with a CPU ONNX 320 variant
    // (board_match ["rpi4b","generic-arm64"], min_tops 0) alongside NPU RKNN
    // 640 variants. A no-NPU Pi 4B must see the model as fit via the CPU
    // variant.
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "coco_yolov8n_v1",
            name: "COCO Object Detector (YOLOv8n)",
            description: "Generic COCO detector (person, car)",
            task: "detection",
            variants: [
              {
                variant: "cpu_int8_320",
                input_size: "320x320",
                min_tops: 0,
                runtime: "onnx",
                board_match: ["rpi4b", "generic-arm64"],
              },
              {
                variant: "int8",
                input_size: "640x640",
                min_tops: 1.0,
                runtime: "rknn",
                board_match: "rk3588",
              },
            ],
          },
        ],
      }),
      PI4B,
    );
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("coco_yolov8n_v1");
    expect(res[0].fits).toBe(true);
    expect(res[0].fitReason).toBeNull();
  });

  it("the same multi-variant detector also fits an RK3588 via its NPU variant", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "coco_yolov8n_v1",
            name: "COCO Object Detector (YOLOv8n)",
            description: "",
            task: "detection",
            variants: [
              {
                variant: "cpu_int8_320",
                input_size: "320x320",
                min_tops: 0,
                runtime: "onnx",
                board_match: ["rpi4b", "generic-arm64"],
              },
              {
                variant: "int8",
                input_size: "640x640",
                min_tops: 1.0,
                runtime: "rknn",
                board_match: "rk3588",
              },
            ],
          },
        ],
      }),
      RK3588,
    );
    expect(res[0].fits).toBe(true);
    expect(res[0].fitReason).toBeNull();
  });

  it("honors a bare-string board_match (the catalog's rk3588 form) on a Pi 4B", () => {
    // An rk3588-only variant given as a bare string must NOT fit a Pi 4B —
    // board_mismatch, listed-but-not-fit (not silently always-fits).
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "rk3588-string-only",
            name: "RK3588 string-match only",
            description: "",
            task: "detection",
            variants: [
              {
                variant: "int8",
                input_size: "640x640",
                min_tops: 1.0,
                runtime: "rknn",
                board_match: "rk3588",
              },
            ],
          },
        ],
      }),
      PI4B,
    );
    expect(res[0].fits).toBe(false);
    expect(res[0].fitReason).toBe("board_mismatch");
  });

  it("a generic-arm64 board_match fits any arm64 board including a Pi 4B", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "arm64-onnx",
            name: "Generic arm64 ONNX",
            description: "",
            task: "detection",
            variants: [
              {
                variant: "cpu_int8_320",
                input_size: "320x320",
                min_tops: 0,
                runtime: "onnx",
                board_match: ["generic-arm64"],
              },
            ],
          },
        ],
      }),
      PI4B,
    );
    expect(res[0].fits).toBe(true);
    expect(res[0].fitReason).toBeNull();
  });

  it("stays permissive when board facts are unknown", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "rknn-unknown-board",
            name: "RKNN",
            description: "",
            task: "detection",
            variants: [{ runtime: "rknn", min_tops: 6, board_match: [] }],
          },
        ],
      }),
      {}, // no soc, no npuRuntime, no npuTops
    );
    // Unknown NPU runtime (not explicitly null) → permissive → fits.
    expect(res[0].fits).toBe(true);
  });

  it("carries the registry benchmark-only flag, false everywhere else", () => {
    const res = filterModelsForBoard(
      models({
        registry: [
          {
            id: "reid-bench",
            name: "Re-ID",
            description: "",
            task: "reid",
            variants: [{ runtime: "onnx", min_tops: 0 }],
            benchmarkOnly: true,
          },
          {
            id: "det",
            name: "Det",
            description: "",
            task: "detection",
            variants: [{ runtime: "onnx", min_tops: 0 }],
          },
        ],
        installed: [{ id: "local", filename: "local.onnx", sizeBytes: 1, format: "onnx" }],
      }),
      PI4B,
    );
    const byId = Object.fromEntries(res.map((m) => [m.id, m.benchmarkOnly]));
    expect(byId).toEqual({ "reid-bench": true, det: false, local: false });
  });
});
