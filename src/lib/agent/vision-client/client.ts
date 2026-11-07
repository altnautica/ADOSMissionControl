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
import { contentDigestHeader, uploadRefusalCopy } from "../upload-digest";
import { selectDetectorInstalling } from "../vision-detector-select";
import {
  UNKNOWN_ENGINE_STATUS,
  VisionAgentError,
  type DesignateBox,
  type DesignateResult,
  type DetectionDemandResult,
  type EngineStatus,
  type VisionClient,
  type VisionDownloadResult,
  type VisionModelStatus,
  type VisionModelsResponse,
  type VisionSetDetectorResult,
  type VisionUploadMeta,
  type VisionUploadResult,
} from "./types";
import {
  coerceBackendState,
  coerceCache,
  coerceCustom,
  coerceEngineModels,
  coerceInstalled,
  coerceProgress,
  coerceRegistry,
  numOpt,
  str,
} from "./coerce";

/** A detector model is tens to hundreds of MB and may cross a radio link,
 *  so the 6 s read default would abort every legitimate upload. It still
 *  needs a bound: unbounded it holds one of the browser's six per-origin
 *  sockets for as long as the peer stays half-open. */
const MODEL_UPLOAD_TIMEOUT_MS = 600_000;

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
   * and restarts the vision service (a ~2 s gap is the safe state). A model
   * the node does not hold is answered 409; the model is then downloaded
   * (202 + `status_url`), polled until installed, and selected again.
   */
  async setActiveDetector(modelId: string): Promise<VisionSetDetectorResult> {
    return selectDetectorInstalling(
      {
        putDetector: (id) => this.putDetector(id),
        download: (id) => this.download(id),
        modelStatus: (id) => this.modelStatus(id),
      },
      modelId,
    );
  }

  private async putDetector(
    modelId: string,
  ): Promise<VisionSetDetectorResult & { notInstalled?: boolean }> {
    const res = await timedFetch(`${this.baseUrl}/api/vision/detector`, {
      method: "PUT",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ model_id: modelId }),
    });
    if (res.status === 409) {
      const text = await res.text().catch(() => "");
      return { status: "error", message: text, notInstalled: true };
    }
    const e = (await this.json(res)) as Record<string, unknown>;
    return {
      status: e.status === "ok" ? "ok" : "error",
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
    const res = await timedFetch(
      `${this.baseUrl}/api/vision/models/upload`,
      {
        method: "POST",
        headers: { ...this.headers(), ...(await contentDigestHeader(file)) },
        body: form,
      },
      MODEL_UPLOAD_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // an opaque body keeps the raw text below
      }
      const copy = uploadRefusalCopy(res.status, parsed);
      throw new VisionAgentError(res.status, copy ?? (text || `HTTP ${res.status}`));
    }
    const body: unknown = await res.json();
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
   * board's NPU TOPS and answers 202 `{status:"started", status_url}`; the
   * progress is polled at that URL via `modelStatus`.
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
    const status = e.status === "ok" || e.status === "started" ? "ok" : "error";
    return {
      status,
      message: str(e.message),
      path: str(e.path) || undefined,
      statusUrl: str(e.status_url) || undefined,
    };
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
   * Hold (or release) a lease on detection for one camera
   * (`POST /api/vision/demand`). The agent runs its detector on a camera only
   * while some consumer holds a lease on it; a lease lasts `holdS` seconds
   * (0..60) and is renewed by repeating the call. `holdS: 0` releases this
   * owner's lease. The agent refuses a camera it does not capture (4xx).
   */
  async requestDetection(
    cameraId: string,
    holdS: number,
    owner: string,
    kind: "detection" | "depth" | "surfaces" = "detection",
  ): Promise<DetectionDemandResult> {
    const body: Record<string, unknown> = { camera_id: cameraId, hold_s: holdS, owner };
    // Detection is the agent's default lease kind; older agents know no other.
    if (kind !== "detection") body.kind = kind;
    const data = await this.json(
      await timedFetch(`${this.baseUrl}/api/vision/demand`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const e = data as Record<string, unknown>;
    return {
      cameraId: typeof e.camera_id === "string" ? e.camera_id : cameraId,
      detecting: e.detecting === true,
      untilMs: typeof e.until_ms === "number" ? e.until_ms : null,
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
      backend: typeof e.backend === "string" ? e.backend : null,
      backendState: coerceBackendState(e.backend_state),
      backendReason: typeof e.backend_reason === "string" ? e.backend_reason : null,
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
