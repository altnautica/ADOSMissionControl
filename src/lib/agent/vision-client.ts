/**
 * @module VisionClient
 * @description Client for the agent's vision model registry endpoints
 * (`/api/vision/models`). Lists the registry + installed + cache state,
 * kicks off a model download, and polls per-model download progress.
 *
 * Mirrors the LAN-direct REST pattern: a base URL + optional API key
 * (sent as `X-ADOS-Key`). All responses are coerced defensively so a
 * future agent that adds fields, or an older agent that omits them,
 * round-trips into a stable GCS-side shape.
 *
 * The model-registry READS (list / download / status) are HTTPS-LAN-safe:
 * on an HTTPS origin they route through the `/api/lan-pair/vision-models`
 * server-side proxy (symmetric with the `setEngineDetector` / `uploadModel`
 * write seam), so a hosted GCS reaches a plain-HTTP LAN agent without the
 * browser's mixed-content guard; on HTTP / Electron the direct fetch is kept.
 * The `designate` write stays on the direct path (it is only ever called from
 * the local-pair / Electron flow where the origin is HTTP).
 *
 * @license GPL-3.0-only
 */

import { timedFetch } from "@/lib/agent/agent-client/timeout";

/** A detector model is tens to hundreds of MB and may cross a radio link,
 *  so the 6 s read default would abort every legitimate upload. It still
 *  needs a bound: unbounded it holds one of the browser's six per-origin
 *  sockets for as long as the peer stays half-open. */
const MODEL_UPLOAD_TIMEOUT_MS = 600_000;

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
}

/** One model file already present in the agent's models directory. */
export interface VisionInstalledModel {
  id: string;
  filename: string;
  sizeBytes: number;
  /** File format: "rknn" | "tflite" | "onnx" | "engine". */
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
  /** File format / runtime: "rknn" | "tflite" | "onnx" | "engine". */
  format: string;
  /** Detector head family (e.g. "yolov8", "yolo11"). Free-form. */
  head: string;
  /** Inference runtime the file targets ("onnx" | "rknn" | "tflite" |
   * "tensorrt"). Free-form so a future agent can advertise another. */
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

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** A finite number, or undefined — so an absent metric stays absent:
 * the hub renders a value only when the agent forwards a real one. */
function numOpt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A boolean, or undefined when the agent does not report the flag. */
function boolOpt(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is string => typeof e === "string");
}

function coerceRegistry(raw: unknown): VisionRegistryModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    return [
      {
        id: str(e.id),
        name: str(e.name),
        description: str(e.description),
        task: str(e.task),
        variants: Array.isArray(e.variants)
          ? (e.variants as Array<Record<string, unknown>>)
          : [],
      },
    ];
  });
}

function coerceInstalled(raw: unknown): VisionInstalledModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    return [
      {
        id: str(e.id),
        filename: str(e.filename),
        sizeBytes: num(e.size_bytes),
        format: str(e.format),
      },
    ];
  });
}

function coerceCustom(raw: unknown): VisionCustomModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    return [
      {
        id: str(e.id),
        name: str(e.name) || str(e.id),
        filename: str(e.filename),
        sizeBytes: num(e.size_bytes),
        format: str(e.format),
        head: str(e.head),
        runtime: str(e.runtime),
        classes: strArray(e.classes),
        inputWidth: num(e.input_width ?? e.input_w),
        inputHeight: num(e.input_height ?? e.input_h),
        boardMatch: strArray(e.board_match),
        verified: e.verified === true,
      },
    ];
  });
}

function coerceCache(raw: unknown): VisionCacheUsage {
  const e =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    usedBytes: num(e.used_bytes),
    maxBytes: num(e.max_bytes),
    usedMb: num(e.used_mb),
    maxMb: num(e.max_mb),
  };
}

function coerceEngineModels(raw: unknown): EngineModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    const id = str(e.id);
    if (!id) return [];
    return [
      {
        id,
        kind: str(e.kind),
        execution: str(e.execution),
        backendLoaded: e.backend_loaded === true,
        outputClasses: strArray(e.output_classes),
        fps: numOpt(e.fps),
        latencyMs: numOpt(e.latency_ms),
        isInferenceCapable: boolOpt(e.is_inference_capable),
      },
    ];
  });
}

function coerceProgress(raw: unknown): VisionDownloadProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  return {
    state: str(e.state) || "idle",
    percent: num(e.percent),
    bytesDownloaded: num(e.bytes_downloaded),
    totalBytes: num(e.total_bytes),
    speedBps: num(e.speed_bps),
    etaSeconds: num(e.eta_seconds),
  };
}

export class VisionAgentClient implements VisionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  /**
   * On an HTTPS origin (a hosted GCS) the browser blocks a direct fetch to the
   * plain-HTTP LAN agent (mixed content), so the model-registry READS route
   * through Mission Control's own `/api/lan-pair/vision-models` proxy — the
   * same server-side hop the write seam (`setEngineDetector` / `uploadModel`)
   * uses. On an HTTP origin (local dev) or Electron the direct fetch is kept
   * (one round-trip, no server in the loop). Computed once: SSR has no window,
   * so it stays direct there too.
   */
  private readonly useProxy: boolean;

  constructor(baseUrl: string, apiKey: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.useProxy =
      typeof window !== "undefined" && window.location.protocol === "https:";
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { "X-ADOS-Key": this.apiKey } : {};
  }

  /**
   * Fetch a model-registry READ op, transparently picking the direct LAN fetch
   * or the proxy hop. `op` selects the upstream endpoint server-side; `init`
   * carries the method/headers for the direct path. Both paths return a raw
   * {@link Response} so the callers coerce the body identically.
   */
  private async fetchModels(
    op: "list" | "download" | "status",
    directPath: string,
    init: RequestInit,
  ): Promise<Response> {
    if (!this.useProxy) {
      return timedFetch(`${this.baseUrl}${directPath}`, init);
    }
    const modelId = directPath.match(/\/api\/vision\/models\/([^/]+)\//)?.[1];
    return timedFetch("/api/lan-pair/vision-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: this.baseUrl,
        apiKey: this.apiKey,
        op,
        modelId: modelId ? decodeURIComponent(modelId) : undefined,
      }),
    });
  }

  /** List registry + installed + custom models, the active detector, and
   * cache usage. `custom` + `active` are absent on older agents and
   * coerce to `[]` / `null`. */
  async listModels(): Promise<VisionModelsResponse> {
    const body = await this.json(
      await this.fetchModels("list", "/api/vision/models", {
        headers: this.headers(),
      }),
    );
    const e = body as Record<string, unknown>;
    return {
      registry: coerceRegistry(e.registry),
      installed: coerceInstalled(e.installed),
      custom: coerceCustom(e.custom),
      active: typeof e.active === "string" ? e.active : null,
      cache: coerceCache(e.cache),
    };
  }

  /**
   * Set the engine's active detector (`PUT /api/vision/detector`). The
   * agent resolves the model id, writes `vision.detector` to its config,
   * and restarts the vision service (a ~2 s gap is the safe state). The
   * model must already be installed (download it first). Returns the
   * agent's status envelope.
   */
  async setActiveDetector(modelId: string): Promise<VisionSetDetectorResult> {
    const body = await this.json(
      await timedFetch(`${this.baseUrl}/api/vision/detector`, {
        method: "PUT",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
      }),
    );
    const e = body as Record<string, unknown>;
    const status = e.status === "ok" ? "ok" : "error";
    return {
      status,
      message: str(e.message),
      modelId: str(e.model_id) || undefined,
    };
  }

  /**
   * Sideload a custom model to this agent (`POST /api/vision/models/upload`,
   * multipart). The file rides as `file`; the metadata rides as a JSON blob
   * under `metadata` (name + classes + head + input dims + runtime +
   * board_match). The agent writes the file + a `custom-catalog.json` entry
   * the model manager reads, so the model then appears in `listModels`
   * under `custom[]`. Returns the assigned id + the agent's verification
   * verdict.
   */
  async uploadModel(
    file: File,
    meta: VisionUploadMeta,
  ): Promise<VisionUploadResult> {
    const form = new FormData();
    form.append("file", file);
    form.append(
      "metadata",
      JSON.stringify({
        name: meta.name,
        classes: meta.classes,
        head: meta.head,
        input_w: meta.inputWidth,
        input_h: meta.inputHeight,
        runtime: meta.runtime,
        board_match: meta.boardMatch,
      }),
    );
    const body = await this.json(
      await timedFetch(
        `${this.baseUrl}/api/vision/models/upload`,
        {
          method: "POST",
          headers: this.headers(),
          body: form,
        },
        MODEL_UPLOAD_TIMEOUT_MS,
      ),
    );
    const e = body as Record<string, unknown>;
    const status = e.status === "ok" ? "ok" : "error";
    return {
      status,
      message: str(e.message),
      modelId: str(e.model_id) || undefined,
      verified: typeof e.verified === "boolean" ? e.verified : undefined,
    };
  }

  /**
   * Kick off a model download. The agent picks the best variant for the
   * board's NPU TOPS. Returns the agent's status envelope; the actual
   * progress is polled separately via `modelStatus`.
   */
  async download(modelId: string): Promise<VisionDownloadResult> {
    const body = await this.json(
      await this.fetchModels(
        "download",
        `/api/vision/models/${encodeURIComponent(modelId)}/download`,
        { method: "POST", headers: this.headers() },
      ),
    );
    const e = body as Record<string, unknown>;
    const status = e.status === "ok" ? "ok" : "error";
    return { status, message: str(e.message), path: str(e.path) || undefined };
  }

  /** Poll download progress + installed state for one model. */
  async modelStatus(modelId: string): Promise<VisionModelStatus> {
    const body = await this.json(
      await this.fetchModels(
        "status",
        `/api/vision/models/${encodeURIComponent(modelId)}/status`,
        { headers: this.headers() },
      ),
    );
    const e = body as Record<string, unknown>;
    return {
      installed: e.installed === true,
      download: coerceProgress(e.download),
    };
  }

  /**
   * Designate the engine's follow target for a camera: lock its tracker onto a
   * specific box (the box the operator clicked), overriding the auto-lock. The
   * box is in the source frame's own pixel resolution — the same coordinates the
   * detection batch declares. Returns whether a target locked + its track id.
   */
  async designate(
    cameraId: string,
    bbox: DesignateBox,
    opts?: { classLabel?: string; confidence?: number },
  ): Promise<DesignateResult> {
    const body: Record<string, unknown> = {
      camera_id: cameraId,
      bbox: {
        x: bbox.x,
        y: bbox.y,
        width: bbox.width,
        height: bbox.height,
      },
    };
    if (opts?.classLabel) body.class_label = opts.classLabel;
    if (typeof opts?.confidence === "number") body.confidence = opts.confidence;
    const data = await this.json(
      await timedFetch(`${this.baseUrl}/api/vision/designate`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const e = data as Record<string, unknown>;
    return {
      designated: e.designated === true,
      trackId: typeof e.track_id === "number" ? e.track_id : null,
    };
  }

  /**
   * Read the engine's registered-model set (`GET /api/vision/status`), so the
   * hub can show a model loaded on the drone but publishing nothing (idle),
   * not only the models in the live detection stream. Direct LAN path — the
   * same posture as the live-detection socket it complements (both are
   * LAN-direct); on a hosted HTTPS session neither flows and the caller falls
   * back to the stream view. An older agent 404s here → an unknown status.
   */
  async getEngineStatus(): Promise<EngineStatus> {
    const res = await timedFetch(`${this.baseUrl}/api/vision/status`, {
      headers: this.headers(),
    });
    if (res.status === 404) return UNKNOWN_ENGINE_STATUS;
    const body = await this.json(res);
    const e = body as Record<string, unknown>;
    const models = coerceEngineModels(e.models);
    return {
      known: true,
      models,
      // Null when the node reports no real value — the hub hides the bar
      // rather than showing a fabricated 0 (no fabricated reading).
      npuUtilizationPct: numOpt(e.npu_utilization_pct) ?? null,
      // Prefer the engine's own count; fall back to the length of the models
      // it actually returned (a real derived figure, never fabricated).
      modelCount: numOpt(e.model_count) ?? models.length,
    };
  }

  private async json(res: Response): Promise<unknown> {
    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`);
      throw new VisionAgentError(res.status, text || `HTTP ${res.status}`);
    }
    return res.json();
  }
}

/**
 * Build a vision client from a resolved agent URL + key, or null when
 * no LAN-routable URL is known (cloud-only sessions). Callers gate the
 * model-registry UI on a non-null return.
 */
export function visionClientFromAgent(
  agentUrl: string | null,
  apiKey: string | null,
): VisionAgentClient | null {
  if (!agentUrl) return null;
  return new VisionAgentClient(agentUrl, apiKey);
}
