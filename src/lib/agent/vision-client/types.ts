/**
 * @module VisionClientTypes
 * @description GCS-side shapes for the agent vision model registry and engine.
 * @license GPL-3.0-only
 */

/** One registry model the agent advertises (available to download). */
export interface VisionRegistryModel {
  id: string;
  name: string;
  description: string;
  /** Output task: "detection" | "tracking" | "depth" | "segmentation". */
  task: string;
  /** Per-variant descriptors (input size, formats, min TOPS). Kept
   * opaque here; the tab renders the variant count, not the internals. */
  variants: Array<Record<string, unknown>>;
  /** True when the registry marks the model for benchmarks and explicit
   * operator installs only: the agent never installs it by default. Absent
   * reads as false. */
  benchmarkOnly?: boolean;
}

/** One model file already present in the agent's models directory. */
export interface VisionInstalledModel {
  id: string;
  filename: string;
  sizeBytes: number;
  /** File format: "rknn" | "tflite" | "onnx". */
  format: string;
}

/**
 * One operator-uploaded custom model the agent tracked in its
 * `custom-catalog.json`. Carries the metadata the operator supplied at
 * upload time so the picker can badge it (classes, head, input dims,
 * runtime, board match) and so the board filter knows whether it fits
 * this node. `verified` reflects the agent's magic-byte / sanity check;
 * an unverified model still installs (the engine's degrade-on-load path
 * is the backstop) but the picker warns.
 */
export interface VisionCustomModel {
  id: string;
  name: string;
  filename: string;
  sizeBytes: number;
  /** File format / runtime: "rknn" | "tflite" | "onnx". */
  format: string;
  /** Detector head family (e.g. "yolov8", "yolo11"). Free-form. */
  head: string;
  /** Inference runtime the file targets ("onnx" | "rknn" | "tflite").
   * Free-form so a future agent can advertise another. */
  runtime: string;
  /** Detection class labels the model emits. */
  classes: string[];
  /** Model input width in pixels (0 when the agent did not record it). */
  inputWidth: number;
  /** Model input height in pixels (0 when the agent did not record it). */
  inputHeight: number;
  /** Board ids this model is meant for (e.g. ["rpi4b", "generic-arm64"]).
   * Empty means the operator declared no constraint (shows everywhere). */
  boardMatch: string[];
  /** True once the agent's upload-time validation passed. */
  verified: boolean;
}

export interface VisionCacheUsage {
  usedBytes: number;
  maxBytes: number;
  usedMb: number;
  maxMb: number;
}

export interface VisionModelsResponse {
  registry: VisionRegistryModel[];
  installed: VisionInstalledModel[];
  /** Operator-uploaded custom models. Empty on agents that predate the
   * upload route. */
  custom: VisionCustomModel[];
  /** Model id the engine has active (reads it at boot), or null when no
   * detector is configured. Undefined on agents that don't report it. */
  active: string | null;
  cache: VisionCacheUsage;
}

/** Metadata the operator supplies when sideloading a custom model. */
export interface VisionUploadMeta {
  name: string;
  classes: string[];
  head: string;
  inputWidth: number;
  inputHeight: number;
  runtime: string;
  /** Board ids the model targets; empty means no constraint. */
  boardMatch: string[];
}

/** The agent's reply to a custom-model upload. */
export interface VisionUploadResult {
  status: "ok" | "error";
  message: string;
  /** The id the agent assigned the uploaded model, when it succeeded. */
  modelId?: string;
  /** Whether the agent's validation passed. */
  verified?: boolean;
}

/** The agent's reply to a set-active-detector call. */
export interface VisionSetDetectorResult {
  status: "ok" | "error";
  message: string;
  /** The model id now configured as the active detector. */
  modelId?: string;
}

export interface VisionDownloadResult {
  status: "ok" | "error";
  message: string;
  path?: string;
  /** The agent's job status URL (`/api/vision/models/<id>/status`) a 202
   * download answers with; the progress is polled there. */
  statusUrl?: string;
}

export interface VisionDownloadProgress {
  /** Download state machine: "idle" | "downloading" | "verifying" |
   * "complete" | "error" (free-form so a future agent can extend it). */
  state: string;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
}

export interface VisionModelStatus {
  installed: boolean;
  download: VisionDownloadProgress | null;
}

/**
 * One model the engine has registered right now (the `/api/vision/status`
 * read-back). Distinct from a {@link VisionInstalledModel} (a file on disk) and
 * a {@link VisionRegistryModel} (available to download): this is a model the
 * running engine actually holds — its task, how it runs, and whether a backend
 * loaded — so the hub can show a model that is loaded but publishing nothing
 * (idle), not only the ones actively producing detections.
 */
export interface EngineModel {
  id: string;
  /** Output task: "detection" | "segmentation" | "classification" |
   * "tracking" (free-form so a future engine can add one). */
  kind: string;
  /** How it runs: "engine_run" (the engine loads + runs it) | "plugin_side"
   * (a plugin runs it). Free-form. */
  execution: string;
  /** True when the engine holds a loaded backend for it. A registered
   * engine-run model whose file failed to load reads false. */
  backendLoaded: boolean;
  /** Class labels the model emits. */
  outputClasses: string[];
  /** Rolling inference frame rate for this model. Undefined when the agent
   * does not report per-model timing — the hub renders it ONLY when real
   * (no fabricated reading), never a fabricated 0. */
  fps?: number;
  /** Mean inference latency in ms. Undefined when the agent does not report
   * per-model timing. */
  latencyMs?: number;
  /** False when the model's backend is a mock / CPU placeholder that produces
   * no real detections; true when it is a real detector. Undefined when the
   * agent does not report it. Drives the "not inference-capable" honesty badge
   * so a mock engine is never presented as a working detector. */
  isInferenceCapable?: boolean;
}

/**
 * What the engine's inference backend can do: `ready` (a real backend that can
 * run inference), `mock` (the explicitly configured bench mock: nothing it
 * reports is measured) or `unavailable` (the requested backend cannot run on
 * this build or board; the engine produces no detections).
 */
export type EngineBackendState = "ready" | "mock" | "unavailable";

/**
 * The engine's `/api/vision/status` read-back: the registered models plus
 * node-level perception telemetry. `npuUtilizationPct` is null when the node
 * reports no real sampler value — the hub HIDES the bar rather than show a
 * fabricated 0 (no fabricated reading). `modelCount` is the engine's own count, falling back
 * to `models.length` when the agent does not report it. With no read-back at
 * all (older agent, unreachable engine, no LAN client) the status is
 * `{ known: false }` and carries no model list or counts, so nothing can render
 * an unread engine as "zero models".
 */
export type EngineStatus =
  | { known: false }
  | {
      known: true;
      models: EngineModel[];
      npuUtilizationPct: number | null;
      modelCount: number;
      /** Backend name (`onnx`, `rknn`, `hailo`, `mock`); null when not reported. */
      backend: string | null;
      /** The backend's state. A reply that omits it reads `unavailable`, never
       * a claimed `ready`. */
      backendState: EngineBackendState;
      /** Why the backend is unavailable, when the engine says; else null. */
      backendReason: string | null;
    };

/** The engine status when there is no read-back (older agent / unreachable). */
export const UNKNOWN_ENGINE_STATUS: EngineStatus = { known: false };

/** A pixel-space box in the source frame's own resolution (origin top-left). */
export interface DesignateBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The agent's reply to a designate: whether a target locked, and its id. */
export interface DesignateResult {
  designated: boolean;
  trackId: number | null;
}

/** The agent's reply to a detection-demand lease (`POST /api/vision/demand`):
 * whether the detector now runs on that camera, and the lease expiry in the
 * agent's own milliseconds (null once nothing holds the camera). */
export interface DetectionDemandResult {
  cameraId: string;
  detecting: boolean;
  untilMs: number | null;
}

export class VisionAgentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "VisionAgentError";
  }
}

/**
 * The subset of the vision client the model-management UI depends on.
 * Both the real {@link VisionAgentClient} and the demo-mode mock satisfy
 * it, so a component can take either without caring which is live.
 */
export interface VisionClient {
  listModels(): Promise<VisionModelsResponse>;
  download(modelId: string): Promise<VisionDownloadResult>;
  modelStatus(modelId: string): Promise<VisionModelStatus>;
  setActiveDetector(modelId: string): Promise<VisionSetDetectorResult>;
  uploadModel(file: File, meta: VisionUploadMeta): Promise<VisionUploadResult>;
  /** The engine's registered-model read-back + node perception telemetry
   * (`GET /api/vision/status`), so the hub shows loaded-but-idle models, per-
   * model fps/latency, and NPU utilization. Optional — an older agent (or a
   * cloud-only session) has no engine read-back; callers treat its absence as
   * "no engine status" and fall back to the live-stream view. */
  getEngineStatus?(): Promise<EngineStatus>;
}
