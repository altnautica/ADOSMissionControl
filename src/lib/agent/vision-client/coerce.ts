/**
 * @module VisionClientCoerce
 * @description Defensive coercion of agent vision responses into stable shapes.
 * @license GPL-3.0-only
 */

import type {
  EngineBackendState,
  EngineModel,
  VisionCacheUsage,
  VisionCustomModel,
  VisionDownloadProgress,
  VisionInstalledModel,
  VisionRegistryModel,
} from "./types";

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** A finite number, or undefined — so an absent metric stays absent:
 * the hub renders a value only when the agent forwards a real one. */
export function numOpt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A boolean, or undefined when the agent does not report the flag. */
export function boolOpt(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is string => typeof e === "string");
}

/** The engine backend state. Anything unrecognised (or absent) reads as
 * `unavailable`: a status that cannot say it is ready is not ready. */
export function coerceBackendState(v: unknown): EngineBackendState {
  return v === "ready" || v === "mock" ? v : "unavailable";
}

export function coerceRegistry(raw: unknown): VisionRegistryModel[] {
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
        benchmarkOnly: e.benchmark_only === true,
      },
    ];
  });
}

export function coerceInstalled(raw: unknown): VisionInstalledModel[] {
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

export function coerceCustom(raw: unknown): VisionCustomModel[] {
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

export function coerceCache(raw: unknown): VisionCacheUsage {
  const e =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    usedBytes: num(e.used_bytes),
    maxBytes: num(e.max_bytes),
    usedMb: num(e.used_mb),
    maxMb: num(e.max_mb),
  };
}

export function coerceEngineModels(raw: unknown): EngineModel[] {
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

export function coerceProgress(raw: unknown): VisionDownloadProgress | null {
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
