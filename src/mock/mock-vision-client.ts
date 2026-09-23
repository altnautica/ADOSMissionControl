/**
 * @module mock/mock-vision-client
 * @description Demo-mode stand-in for the vision model client. Returns a small
 * canned registry + an installed model + one custom upload + an active detector
 * so the Vision tab and the model picker render and exercise their full flow in
 * `npm run demo` without a real agent on the LAN.
 *
 * Set-active and upload mutate the in-memory state so the UI reflects the
 * operator's action for the session (a download flips the model to installed,
 * set-active flips the active id, an upload appends a custom row). Nothing is
 * persisted; reloading resets the demo state.
 *
 * Only loaded behind `isDemoMode()`. Never import this from a production code
 * path.
 *
 * @license GPL-3.0-only
 */

import type {
  EngineModel,
  EngineStatus,
  VisionClient,
  VisionCustomModel,
  VisionDownloadResult,
  VisionInstalledModel,
  VisionModelStatus,
  VisionModelsResponse,
  VisionRegistryModel,
  VisionSetDetectorResult,
  VisionUploadMeta,
  VisionUploadResult,
} from "@/lib/agent/vision-client";

const REGISTRY: VisionRegistryModel[] = [
  {
    id: "yolov8n-coco-320",
    name: "YOLOv8n COCO 320",
    description: "Lightweight 80-class detector, CPU-friendly.",
    task: "detection",
    variants: [
      { runtime: "onnx", min_tops: 0, board_match: ["rpi4b", "generic-arm64"] },
      { runtime: "rknn", min_tops: 3, board_match: ["rock-5c-lite"] },
    ],
  },
  {
    id: "yolov8s-coco-640",
    name: "YOLOv8s COCO 640",
    description: "Higher-accuracy detector, NPU recommended.",
    task: "detection",
    variants: [{ runtime: "rknn", min_tops: 6, board_match: [] }],
  },
  {
    id: "osnet-reid",
    name: "OSNet Re-ID",
    description: "Appearance embedding for re-identification.",
    task: "tracking",
    variants: [
      { runtime: "onnx", min_tops: 0, board_match: ["generic-arm64"] },
    ],
  },
];

const INSTALLED: VisionInstalledModel[] = [
  {
    id: "yolov8n-coco-320",
    filename: "yolov8n-coco-320.onnx",
    sizeBytes: 6_200_000,
    format: "onnx",
  },
];

const CUSTOM_SEED: VisionCustomModel[] = [
  {
    id: "custom-cones-1",
    name: "Cones (demo upload)",
    filename: "cones.onnx",
    sizeBytes: 5_900_000,
    format: "onnx",
    head: "yolov8",
    runtime: "onnx",
    classes: ["cone"],
    inputWidth: 320,
    inputHeight: 320,
    boardMatch: ["generic-arm64"],
    verified: true,
  },
];

/** A session-scoped mock that mutates its own in-memory registry/active set so
 * the picker reacts to operator actions in demo mode. */
class DemoVisionClient implements VisionClient {
  private installed = new Set(INSTALLED.map((m) => m.id));
  private custom: VisionCustomModel[] = CUSTOM_SEED.map((m) => ({ ...m }));
  private active: string | null = "yolov8n-coco-320";
  private uploadSeq = 0;

  async listModels(): Promise<VisionModelsResponse> {
    const installed: VisionInstalledModel[] = Array.from(this.installed).map(
      (id) => {
        const existing = INSTALLED.find((m) => m.id === id);
        return (
          existing ?? {
            id,
            filename: `${id}.onnx`,
            sizeBytes: 6_000_000,
            format: "onnx",
          }
        );
      },
    );
    return {
      registry: REGISTRY.map((m) => ({ ...m })),
      installed,
      custom: this.custom.map((m) => ({ ...m })),
      active: this.active,
      cache: {
        usedBytes: 12_100_000,
        maxBytes: 2_000_000_000,
        usedMb: 12,
        maxMb: 2000,
      },
    };
  }

  async download(modelId: string): Promise<VisionDownloadResult> {
    // Mark installed immediately; the poll loop then reports complete.
    this.installed.add(modelId);
    return { status: "ok", message: "download started" };
  }

  async modelStatus(modelId: string): Promise<VisionModelStatus> {
    const installed = this.installed.has(modelId);
    return {
      installed,
      download: {
        state: installed ? "complete" : "downloading",
        percent: installed ? 100 : 50,
        bytesDownloaded: installed ? 6_000_000 : 3_000_000,
        totalBytes: 6_000_000,
        speedBps: 2_000_000,
        etaSeconds: installed ? 0 : 2,
      },
    };
  }

  async setActiveDetector(modelId: string): Promise<VisionSetDetectorResult> {
    this.active = modelId;
    return { status: "ok", message: "detector set", modelId };
  }

  async uploadModel(
    file: File,
    meta: VisionUploadMeta,
  ): Promise<VisionUploadResult> {
    const id = `custom-upload-${++this.uploadSeq}`;
    this.custom.push({
      id,
      name: meta.name || file.name,
      filename: file.name,
      sizeBytes: file.size,
      format: meta.runtime || "onnx",
      head: meta.head,
      runtime: meta.runtime,
      classes: meta.classes,
      inputWidth: meta.inputWidth,
      inputHeight: meta.inputHeight,
      boardMatch: meta.boardMatch,
      verified: true,
    });
    this.installed.add(id);
    return { status: "ok", message: "uploaded", modelId: id, verified: true };
  }

  async getEngineStatus(): Promise<EngineStatus> {
    // The demo engine runs the streaming detector (`demo-yolov8n`, which the
    // mock detection feed publishes on) plus one loaded-but-idle re-id model,
    // so the hub shows both an active pipeline and a "loaded · idle" row.
    // Demo mode is mock by design (demo mode works offline), so it carries fps/latency + NPU
    // utilization to exercise the telemetry UI without a real agent.
    const models: EngineModel[] = [
      {
        id: "demo-yolov8n",
        kind: "detection",
        execution: "engine_run",
        backendLoaded: true,
        outputClasses: ["person", "car", "truck"],
        fps: 27.4,
        latencyMs: 18.2,
        isInferenceCapable: true,
      },
      {
        id: "osnet-reid",
        kind: "tracking",
        execution: "engine_run",
        backendLoaded: true,
        outputClasses: [],
        isInferenceCapable: true,
      },
    ];
    return { known: true, models, npuUtilizationPct: 41.5, modelCount: models.length };
  }
}

let singleton: DemoVisionClient | null = null;

/** The shared demo vision client for the session (so a set-active in one
 * surface is visible from another). */
export function demoVisionClient(): VisionClient {
  if (!singleton) singleton = new DemoVisionClient();
  return singleton;
}
