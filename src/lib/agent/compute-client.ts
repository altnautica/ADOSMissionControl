/**
 * @module compute-client
 * @description LAN client for a compute node. Two surfaces on two ports:
 *
 *  - **Status** (`GET /api/compute/status` on the ados-control front, `:8080`):
 *    the cluster-status sidecar (the same camelCase `compute*` fields the cloud
 *    heartbeat carries), read by the compute-cluster card local-first (Rule 39).
 *  - **Jobs** (`/api/compute/{jobs,datasets,...}` on the ados-compute engine's
 *    own listener, `:8092`): submit / list / read reconstruction + offload jobs
 *    and their outputs. NOT proxied through `:8080`, so the job base is derived
 *    from the node host with the engine port swapped in.
 *
 * Mirrors `vision-client.ts`: on an HTTPS origin (a hosted GCS) the job calls
 * route through Mission Control's own `/api/lan-pair/compute` server proxy to
 * dodge the browser's mixed-content guard and resolve `*.local` server-side; on
 * an HTTP origin / Electron the direct fetch is kept. Every reply is coerced
 * defensively and a `404` / transport failure returns `null` / `[]` so a poll
 * never throws and the workbench shows an "awaiting compute node" state.
 * @license GPL-3.0-only
 */

import type { ComputeGpuInfo } from "@/stores/compute-store";
import { grantArtifactAccess, proxiedArtifactUrl } from "./compute-artifact";
import { timedFetch } from "@/lib/agent/agent-client/timeout";

/** The ados-compute engine's own job-API port, distinct from the ados-control
 * front on `:8080` that serves {@link ComputeAgentClient.getStatus}. */
export const COMPUTE_JOB_PORT = "8092";

/**
 * Parsed shape of the compute node's status sidecar (`GET /api/compute/status`)
 * beyond the cluster fields the heartbeat fan-out already maps. The `gpu` block
 * is what the workstation GPU surfaces read; it is null on a node with no GPU.
 */
export interface ComputeStatus {
  gpu: ComputeGpuInfo | null;
}

/**
 * Coerce the snake_case `gpu` block from `GET /api/compute/status` into the
 * camelCase {@link ComputeGpuInfo}. Returns null when the block is absent or not
 * an object; each field independently degrades to null when missing or the
 * wrong type, so a partial reading (e.g. name known, utilization not) still
 * surfaces what the node does report. Wire keys: `name` / `cores` /
 * `unified_memory_mb` / `metal` / `utilization_pct`.
 */
export function parseComputeGpu(raw: unknown): ComputeGpuInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  const n = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const s = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    name: s(g.name),
    cores: n(g.cores),
    unifiedMemoryMb: n(g.unified_memory_mb),
    metal: s(g.metal),
    utilizationPct: n(g.utilization_pct),
  };
}

/** Lifecycle state of a compute job (lowercase on the wire). Left open so a
 * future engine can advertise another state without breaking the type. */
export type ComputeJobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | (string & {});

/** One reconstruction / offload job the engine tracks. */
export interface ComputeJob {
  id: string;
  /** "reconstruct" | "perception_offload" | "slam_offload" (free-form). */
  kind: string;
  datasetId: string | null;
  state: ComputeJobState;
  /** Progress in `0..1` while running. */
  progress: number;
  /** Where the finished artifact can be fetched, or null until done. */
  resultRef: string | null;
  /** Failure detail when `state` is "failed". */
  error: string | null;
  /** The capturing session a reconstruct job belongs to (lifted from the job's
   * params by the engine), or null for a job that carries none (an offload job,
   * or a reconstruct job from an agent before the session was tagged). Lets the
   * GCS correlate a world-model artifact to a drone's active session. */
  sessionId: string | null;
  /** The Brush training-step count a reconstruct job ran (lifted from the job's
   * `params.steps`), or null for a job that carries none. Lets the GCS label a
   * reconstruction with its detail level. */
  steps: number | null;
  createdMs: number;
  updatedMs: number;
}

/** One artifact a finished job produced. */
export interface ComputeOutput {
  id: string;
  jobId: string;
  /** Artifact kind ("splat" | "cloud" | "mesh" | ...). */
  kind: string;
  /** Fetchable URI for the artifact (stream-lane url or handle). */
  uri: string;
  /** The concrete reconstruction backend that produced this artifact, lifted
   * from `meta.backend`: `"mock"` is a deterministic placeholder (a node with no
   * GPU / no real backend installed) and is NEVER a real world model; a real
   * backend is `"brush"` / `"msplat"` / `"nerfstudio"` / `"colmap"`. `null` when
   * a pre-field agent advertises none. Drives the reconstruction-honesty badge
   * so an operator never mistakes a mock splat for a real reconstruction
   * (Rule 44). */
  backend: string | null;
  /** The raw backend result metadata (`gaussian_count`, `backend`, …) served on
   * the output, or null when absent — kept so a surface can read further detail
   * without a second fetch. */
  meta: Record<string, unknown> | null;
  createdMs: number;
}

/** One input dataset a job ran (or will run) on. */
export interface ComputeDataset {
  id: string;
  kind: string;
  createdMs: number;
}

/** A job submission. */
export interface ComputeSubmitRequest {
  jobId?: string;
  kind: string;
  datasetId?: string;
  params?: Record<string, unknown>;
}

/** The engine's reply to a job submission. */
export interface ComputeSubmitResult {
  jobId: string;
  state: ComputeJobState;
}

/** A dataset-creation request. */
export interface ComputeDatasetRequest {
  id?: string;
  kind: string;
  meta?: Record<string, unknown>;
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

function coerceJob(raw: unknown): ComputeJob | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string") return null;
  const params =
    e.params && typeof e.params === "object" && !Array.isArray(e.params)
      ? (e.params as Record<string, unknown>)
      : null;
  return {
    id: e.id,
    kind: str(e.kind),
    datasetId: strOrNull(e.dataset_id),
    state: str(e.state),
    progress: num(e.progress),
    resultRef: strOrNull(e.result_ref),
    error: strOrNull(e.error),
    sessionId: strOrNull(e.session_id),
    steps:
      params && typeof params.steps === "number" && params.steps > 0
        ? params.steps
        : null,
    createdMs: num(e.created_ms),
    updatedMs: num(e.updated_ms),
  };
}

function coerceOutput(raw: unknown): ComputeOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.uri !== "string") return null;
  const meta =
    e.meta && typeof e.meta === "object" && !Array.isArray(e.meta)
      ? (e.meta as Record<string, unknown>)
      : null;
  // The honest backend rides `meta.backend`. Fall back to the `mock://` uri
  // scheme so a pre-field agent (no `meta.backend`) that still emits a
  // placeholder artifact is caught by the honesty badge (Rule 44,
  // defense-in-depth).
  const metaBackend =
    typeof meta?.backend === "string" && meta.backend.length > 0
      ? meta.backend
      : null;
  const backend = metaBackend ?? (e.uri.startsWith("mock://") ? "mock" : null);
  return {
    id: e.id,
    jobId: str(e.job_id),
    kind: str(e.kind),
    uri: e.uri,
    backend,
    meta,
    createdMs: num(e.created_ms),
  };
}

/**
 * Whether a compute output is a placeholder (mock) reconstruction rather than a
 * real world model — true when the honest backend is `"mock"` OR the artifact
 * uri uses the `mock://` scheme (the pre-field-agent fallback). An operator must
 * never mistake a placeholder splat for a real reconstruction (Rule 44).
 */
export function isPlaceholderArtifact(o: ComputeOutput): boolean {
  return o.backend === "mock" || o.uri.startsWith("mock://");
}

function coerceDataset(raw: unknown): ComputeDataset | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string") return null;
  return { id: e.id, kind: str(e.kind), createdMs: num(e.created_ms) };
}

export class ComputeAgentClient {
  private readonly baseUrl: string;
  private readonly jobBase: string;
  private readonly apiKey: string | null;
  /** HTTPS origin → route job calls through the `/api/lan-pair/compute` proxy;
   * HTTP / Electron / SSR → fetch the engine port directly. */
  private readonly useProxy: boolean;

  constructor(baseUrl: string, apiKey: string | null = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.jobBase = ComputeAgentClient.deriveJobBase(this.baseUrl);
    this.apiKey = apiKey;
    this.useProxy =
      typeof window !== "undefined" && window.location.protocol === "https:";
  }

  /** The same host as the control front, with the engine job port swapped in. */
  private static deriveJobBase(baseUrl: string): string {
    try {
      const u = new URL(baseUrl);
      u.port = COMPUTE_JOB_PORT;
      return u.origin;
    } catch {
      return baseUrl;
    }
  }

  private authHeader(): Record<string, string> {
    return this.apiKey ? { "X-ADOS-Key": this.apiKey } : {};
  }

  /**
   * The compute node's cluster status (the heartbeat sidecar JSON), or `null`
   * on `404` / non-object / transport failure — so a poll never throws and a
   * non-compute node (no sidecar → `404`) is simply skipped. Served by the
   * control front on `:8080`.
   */
  async getStatus(): Promise<Record<string, unknown> | null> {
    let res: Response;
    try {
      res = await timedFetch(`${this.baseUrl}/api/compute/status`, {
        headers: this.authHeader(),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    try {
      const body = (await res.json()) as unknown;
      return typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Issue one job-API request, transparently picking the direct LAN fetch
   * (`:8092`) or the `/api/lan-pair/compute` proxy hop (HTTPS origin). `path`
   * is the segment after `/api/compute/` (e.g. `jobs`, `jobs/<id>/cancel`).
   * Returns the parsed JSON body, or `null` on non-2xx / transport / parse
   * failure so every caller degrades to an empty state instead of throwing.
   */
  private async jobRequest(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<unknown | null> {
    let res: Response;
    try {
      if (this.useProxy) {
        res = await timedFetch("/api/lan-pair/compute", {
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
        const hasBody = body !== undefined;
        res = await timedFetch(`${this.jobBase}/api/compute/${path}`, {
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
    if (!res.ok) return null;
    try {
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  }

  /** List every job on the node. `null` = unreachable; `[]` = reachable + empty. */
  async listJobs(): Promise<ComputeJob[] | null> {
    const body = await this.jobRequest("jobs", "GET");
    if (body === null) return null;
    if (!Array.isArray(body)) return [];
    return body.flatMap((j) => {
      const job = coerceJob(j);
      return job ? [job] : [];
    });
  }

  /** Fetch one job by id, or `null` when missing / unreachable. */
  async getJob(id: string): Promise<ComputeJob | null> {
    const body = await this.jobRequest(`jobs/${encodeURIComponent(id)}`, "GET");
    return body ? coerceJob(body) : null;
  }

  /** A job's output artifacts. `null` = unreachable; `[]` = reachable + none.
   * Each real artifact URL is rewritten to the same-origin artifact proxy at the
   * paired host, so the browser reaches the blob (the engine stamps a drifting
   * mDNS `.local` host the browser cannot resolve). */
  async getOutputs(id: string): Promise<ComputeOutput[] | null> {
    const body = await this.jobRequest(
      `jobs/${encodeURIComponent(id)}/outputs`,
      "GET",
    );
    if (body === null) return null;
    if (!Array.isArray(body)) return [];
    // The proxy takes this node's key from an HttpOnly cookie rather than
    // from the URL, so mint the grant before handing any URL to a viewer.
    await grantArtifactAccess(this.baseUrl, this.apiKey);
    return body.flatMap((o) => {
      const out = coerceOutput(o);
      if (!out) return [];
      out.uri = proxiedArtifactUrl(out.uri, this.baseUrl);
      return [out];
    });
  }

  /** Submit a job. Returns the assigned id + initial state, or `null` on failure. */
  async submitJob(
    req: ComputeSubmitRequest,
  ): Promise<ComputeSubmitResult | null> {
    const body = await this.jobRequest("jobs", "POST", {
      job_id: req.jobId,
      kind: req.kind,
      dataset_id: req.datasetId,
      params: req.params ?? null,
    });
    if (!body || typeof body !== "object") return null;
    const e = body as Record<string, unknown>;
    if (typeof e.job_id !== "string") return null;
    return { jobId: e.job_id, state: str(e.state) };
  }

  /** Request cancellation of a queued / running job. Returns whether it took. */
  async cancelJob(id: string): Promise<boolean> {
    const body = await this.jobRequest(
      `jobs/${encodeURIComponent(id)}/cancel`,
      "POST",
    );
    if (!body || typeof body !== "object") return false;
    return (body as Record<string, unknown>).cancelled === true;
  }

  /** Create an input dataset, or `null` on failure. */
  async createDataset(
    req: ComputeDatasetRequest,
  ): Promise<ComputeDataset | null> {
    const body = await this.jobRequest("datasets", "POST", {
      id: req.id,
      kind: req.kind,
      meta: req.meta ?? null,
    });
    return body ? coerceDataset(body) : null;
  }
}
