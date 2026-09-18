/**
 * @module atlas-control-client
 * @description LAN client for a drone agent's Atlas capture-control surface on
 * the ados-control front (`:8080`, the same port as `/api/plugins/*` and
 * `/api/vision/*`). Drives the founder-locked contract:
 *
 *  - `GET  /api/atlas/readiness`        — capture readiness snapshot
 *  - `PUT  /api/atlas/config`           — patch { enabled?, capture_profile? }
 *  - `POST /api/atlas/capture/{start,stop,pause,resume}` — capture lifecycle
 *
 * Local-first (Rule 39), mirroring `compute-client.ts` / `vision-client.ts`: on
 * an HTTPS origin (a hosted GCS) every call routes through Mission Control's own
 * `/api/lan-pair/atlas` server proxy to dodge the browser's mixed-content guard
 * and resolve `*.local` server-side; on an HTTP origin / Electron the direct
 * fetch is kept. Unlike `compute-client`, Atlas lives on the `:8080` control
 * front, so the base URL is used verbatim (no engine-port swap).
 *
 * Every reply is coerced defensively: a transport failure or a non-JSON body
 * returns `null` (reads) or a typed non-ok result (capture actions) so a poll
 * loop or a button handler degrades instead of throwing. A `503` on a capture
 * action means the capture service is down; it is surfaced distinctly so the UI
 * can say so honestly (Rule 44) rather than a generic failure.
 *
 * @license GPL-3.0-only
 */

import { DEFAULT_RECONSTRUCTION_STEPS } from "@/lib/atlas/reconstruction-quality";
import { timedFetch } from "@/lib/agent/agent-client/timeout";

/** Pose-estimation source the capture rig runs. Left open so a richer agent can
 * advertise another source without breaking the type. */
export type AtlasPoseSource =
  | "local_vio"
  | "offloaded_slam"
  | "hybrid"
  | (string & {});

/** Capture lifecycle state (lowercase on the wire). Open for forward states. */
export type AtlasCaptureState =
  | "idle"
  | "capturing"
  | "paused"
  | "finalizing"
  | "bagged"
  | (string & {});

/**
 * Whether a capture state counts as an active (Live-World-visible) session:
 * actively ingesting, paused, or finalizing. Derived from `state` so a surface
 * never depends on how an agent populates the standalone `capturing` bool during
 * a paused session — an agent that reports `capturing:false` while `state:"paused"`
 * must still read as an active session (Rule 44 consistency).
 */
export function isActiveCaptureState(state: string): boolean {
  return state === "capturing" || state === "paused" || state === "finalizing";
}

/** The `GET /api/atlas/readiness` snapshot, coerced to camelCase. */
export interface AtlasReadiness {
  enabled: boolean;
  profile: string;
  captureProfile: string;
  /** The default reconstruction detail level (Brush training steps) commissioned
   * from this drone's tab. Persisted on the drone's atlas config alongside
   * `capture_profile`; defaults to the recommended level when the agent has none. */
  reconstructSteps: number;
  camerasConfigured: number;
  poseSource: AtlasPoseSource;
  serviceRunning: boolean;
  capturing: boolean;
  state: AtlasCaptureState;
  sessionId: string | null;
  cameraCount: number;
  keyframes: number;
  ingestRateHz: number;
}

/** The `POST /api/atlas/capture/*` reply, coerced to camelCase. */
export interface CaptureStatus {
  sessionId: string;
  state: AtlasCaptureState;
  keyframes: number;
  vioHealth: string;
  cameraCount: number;
  ingestRateHz: number;
}

/** Result of a capture lifecycle action. Discriminated so a 503 (capture
 * service down) is distinguishable from a transport failure or a success. */
export type CaptureResult =
  | { ok: true; status: CaptureStatus }
  | { ok: false; serviceDown: boolean; message: string };

/** A `PUT /api/atlas/config` patch (camelCase; mapped to snake_case on the wire). */
export interface AtlasConfigPatch {
  enabled?: boolean;
  captureProfile?: string;
  /** Default reconstruction detail level, in Brush training steps. */
  reconstructSteps?: number;
}

/** The `PUT /api/atlas/config` reply, coerced to camelCase. */
export interface AtlasConfigResult {
  status: string;
  enabled: boolean;
  restart: Record<string, unknown>;
}

function bool(v: unknown): boolean {
  return v === true;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Coerce a raw readiness body, or null when it is not an object. */
export function coerceReadiness(raw: unknown): AtlasReadiness | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  return {
    enabled: bool(e.enabled),
    profile: str(e.profile),
    captureProfile: str(e.capture_profile),
    // Default to the recommended level when the agent reports none (older agent
    // or unset config), so the picker always has a valid selection.
    reconstructSteps:
      num(e.reconstruct_steps) > 0
        ? num(e.reconstruct_steps)
        : DEFAULT_RECONSTRUCTION_STEPS,
    camerasConfigured: num(e.cameras_configured),
    poseSource: str(e.pose_source) || "local_vio",
    serviceRunning: bool(e.service_running),
    capturing: bool(e.capturing),
    state: (str(e.state) || "idle") as AtlasCaptureState,
    sessionId: strOrNull(e.session_id),
    cameraCount: num(e.camera_count),
    keyframes: num(e.keyframes),
    ingestRateHz: num(e.ingest_rate_hz),
  };
}

/** Coerce a raw capture-status body, or null when it is not an object. */
export function coerceCaptureStatus(raw: unknown): CaptureStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  return {
    sessionId: str(e.session_id),
    state: (str(e.state) || "idle") as AtlasCaptureState,
    keyframes: num(e.keyframes),
    vioHealth: str(e.vio_health),
    cameraCount: num(e.camera_count),
    ingestRateHz: num(e.ingest_rate_hz),
  };
}

type Method = "GET" | "POST" | "PUT";

/** One HTTP exchange with the agent's Atlas surface. `null` = transport/parse
 * failure (never a real agent status); otherwise the agent's status + parsed
 * JSON (json is null on a non-JSON body). */
interface AtlasResponse {
  status: number;
  json: unknown;
}

export class AtlasControlClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  /** HTTPS origin → route through the `/api/lan-pair/atlas` proxy; HTTP /
   * Electron / SSR → direct fetch to the agent's `:8080` control front. */
  private readonly useProxy: boolean;

  constructor(baseUrl: string, apiKey: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.useProxy =
      typeof window !== "undefined" && window.location.protocol === "https:";
  }

  private authHeader(): Record<string, string> {
    return this.apiKey ? { "X-ADOS-Key": this.apiKey } : {};
  }

  /**
   * Issue one Atlas request, transparently picking the direct LAN fetch or the
   * `/api/lan-pair/atlas` proxy hop (HTTPS origin). `path` is the segment after
   * `/api/atlas/` (e.g. `readiness`, `config`, `capture/start`). Returns the
   * agent status + parsed JSON, or `null` on transport/parse failure so callers
   * degrade instead of throwing.
   */
  private async request(
    path: string,
    method: Method,
    body?: unknown,
  ): Promise<AtlasResponse | null> {
    let res: Response;
    try {
      if (this.useProxy) {
        res = await timedFetch("/api/lan-pair/atlas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: this.baseUrl,
            apiKey: this.apiKey,
            path,
            method,
            body: body ?? null,
          }),
        });
      } else {
        const hasBody = body !== undefined && body !== null;
        res = await timedFetch(`${this.baseUrl}/api/atlas/${path}`, {
          method,
          headers: {
            Accept: "application/json",
            ...this.authHeader(),
            ...(hasBody ? { "Content-Type": "application/json" } : {}),
          },
          body: hasBody ? JSON.stringify(body) : undefined,
        });
      }
    } catch {
      return null;
    }
    // A misbehaving fetch (or a broken polyfill) can resolve undefined; treat it
    // as a transport failure rather than reading `.status` off nothing.
    if (!res) return null;
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  /**
   * The drone's Atlas readiness, or `null` on non-2xx / transport / parse
   * failure — so a poll never throws and a drone with no Atlas surface (404) is
   * simply treated as "no readiness".
   */
  async getReadiness(): Promise<AtlasReadiness | null> {
    const res = await this.request("readiness", "GET");
    if (!res || res.status < 200 || res.status >= 300) return null;
    return coerceReadiness(res.json);
  }

  /**
   * Patch the Atlas config (enable/disable, capture profile, camera set). The
   * camelCase patch maps to the wire's snake_case (`capture_profile`). Returns
   * the agent's `{ status, enabled, restart }`, or `null` on failure.
   */
  async setConfig(patch: AtlasConfigPatch): Promise<AtlasConfigResult | null> {
    const wire: Record<string, unknown> = {};
    if (patch.enabled !== undefined) wire.enabled = patch.enabled;
    if (patch.captureProfile !== undefined)
      wire.capture_profile = patch.captureProfile;
    if (patch.reconstructSteps !== undefined)
      wire.reconstruct_steps = patch.reconstructSteps;
    const res = await this.request("config", "PUT", wire);
    if (!res || res.status < 200 || res.status >= 300) return null;
    const e = obj(res.json);
    return {
      status: str(e.status) || "ok",
      enabled: bool(e.enabled),
      restart: obj(e.restart),
    };
  }

  /** Drive one capture lifecycle action. A `503` reports the capture service is
   * down (distinct from a transport failure) so the UI stays honest. */
  private async capture(
    sub: "start" | "stop" | "pause" | "resume",
  ): Promise<CaptureResult> {
    const res = await this.request(`capture/${sub}`, "POST");
    if (!res) {
      return { ok: false, serviceDown: false, message: "transport_error" };
    }
    if (res.status === 503) {
      return { ok: false, serviceDown: true, message: "service_unavailable" };
    }
    if (res.status < 200 || res.status >= 300) {
      const e = obj(res.json);
      return {
        ok: false,
        serviceDown: false,
        message: str(e.message) || `http_${res.status}`,
      };
    }
    const status = coerceCaptureStatus(res.json);
    if (!status) {
      return { ok: false, serviceDown: false, message: "bad_response" };
    }
    return { ok: true, status };
  }

  captureStart(): Promise<CaptureResult> {
    return this.capture("start");
  }

  captureStop(): Promise<CaptureResult> {
    return this.capture("stop");
  }

  capturePause(): Promise<CaptureResult> {
    return this.capture("pause");
  }

  captureResume(): Promise<CaptureResult> {
    return this.capture("resume");
  }
}
