"use client";

import { Cpu, Eye, Camera, HardDrive, Activity, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { AgentProfile } from "@/stores/agent-capabilities-store";
import { useComputeStore } from "@/stores/compute-store";
import type { ComputeGpuInfo } from "@/stores/compute-store";
import { ResourceBar } from "./SystemResourceGauges";

interface ComputeMetricsCardProps {
  className?: string;
  /** Node profile. "workstation" swaps the NPU/Tier (SBC) view for the GPU
   * card — a workstation runs a GPU, not a tiered NPU. Absent / drone /
   * ground-station keep the existing NPU + vision + models + cameras card. */
  profile?: AgentProfile;
}

const RUNTIME_LABELS: Record<string, string> = {
  rknn: "RKNN",
  tensorrt: "TensorRT",
  tflite: "TFLite",
  opencv_dnn: "OpenCV DNN",
};

function npuBarColor(percent: number): string {
  if (percent >= 90) return "bg-status-error";
  if (percent >= 70) return "bg-status-warning";
  return "bg-accent-primary";
}

function visionStateColor(
  state: string
): { text: string; pulse: boolean; spinner: boolean } {
  switch (state) {
    case "off":
      return { text: "text-text-tertiary", pulse: false, spinner: false };
    case "initializing":
      return { text: "text-accent-primary", pulse: false, spinner: true };
    case "ready":
      return { text: "text-status-success", pulse: false, spinner: false };
    case "active":
      return { text: "text-status-success", pulse: true, spinner: false };
    case "degraded":
      return { text: "text-status-warning", pulse: false, spinner: false };
    case "error":
      return { text: "text-status-error", pulse: false, spinner: false };
    default:
      return { text: "text-text-tertiary", pulse: false, spinner: false };
  }
}

/** The `atlas` i18n key for a vision engine state, or null for an unknown state
 * (rendered raw). */
function visionStateKey(state: string): string | null {
  switch (state) {
    case "off":
      return "visionOff";
    case "initializing":
      return "visionInitializing";
    case "ready":
      return "visionReady";
    case "active":
      return "visionActive";
    case "degraded":
      return "visionDegraded";
    case "error":
      return "visionError";
    default:
      return null;
  }
}

/** Whole-GB label for an MB figure, or "—" when absent. */
function gbLabel(mb: number | null): string {
  if (mb == null || !Number.isFinite(mb)) return "—";
  return `${Math.round(mb / 1024)} GB`;
}

/**
 * Workstation GPU card: identity (name / cores / unified memory / Metal) plus a
 * LIVE utilisation bar from the compute-status poll. Reuses {@link ResourceBar}
 * so the bar reads on the same scale as the CPU/memory gauges. Renders a calm
 * "awaiting GPU telemetry" line before the first poll, and is truthful when a
 * field is absent (no fabricated 0% — the bar is dropped when util is null).
 */
function WorkstationGpuCard({
  gpu,
  className,
}: {
  gpu: ComputeGpuInfo | null;
  className?: string;
}) {
  const t = useTranslations("atlas");
  const util = gpu?.utilizationPct ?? null;
  return (
    <div className={cn("border border-border-default rounded-lg p-4 space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">{t("gpu")}</span>
        </div>
        {gpu?.metal && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent-primary/15 text-accent-primary">
            {t("metal")}
          </span>
        )}
      </div>

      {gpu === null ? (
        <div className="text-[10px] text-text-tertiary text-center py-3">
          {t("gpuAwaiting")}
        </div>
      ) : (
        <>
          {/* Identity */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono text-text-primary truncate">
              {gpu.name ?? "—"}
            </span>
            {gpu.cores != null && (
              <span className="text-[10px] font-mono text-text-tertiary flex-shrink-0">
                {t("gpuCores", { cores: gpu.cores })}
              </span>
            )}
          </div>

          {/* Live utilisation — truthful: only when the node reports it. */}
          {util != null ? (
            <ResourceBar
              icon={Activity}
              label={t("gpu")}
              percent={util}
              detail={t("utilization", { pct: util.toFixed(1) })}
              stale={false}
              staleLabel=""
            />
          ) : (
            <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
              <Activity size={10} className="flex-shrink-0" />
              <span>{t("gpuAwaiting")}</span>
            </div>
          )}

          {gpu.unifiedMemoryMb != null && (
            <div className="flex items-center justify-between border-t border-border-default pt-2">
              <span className="text-[10px] text-text-secondary">
                {t("unifiedMemory")}
              </span>
              <span className="text-[10px] font-mono text-text-primary">
                {gbLabel(gpu.unifiedMemoryMb)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ComputeMetricsCard({ className, profile }: ComputeMetricsCardProps) {
  const t = useTranslations("atlas");
  const gpu = useComputeStore((s) => s.gpu);
  const tier = useAgentCapabilitiesStore((s) => s.tier);
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const vision = useAgentCapabilitiesStore((s) => s.vision);
  const models = useAgentCapabilitiesStore((s) => s.models);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);

  // A workstation runs a GPU, not a tiered NPU — show the GPU card and skip the
  // NPU/Tier/vision/models view entirely.
  if (profile === "workstation") {
    return <WorkstationGpuCard gpu={gpu} className={className} />;
  }

  if (!loaded) {
    return (
      <div className={cn("border border-border-default rounded-lg p-4", className)}>
        <div className="flex items-center gap-1.5 mb-3">
          <Cpu className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">{t("compute")}</span>
        </div>
        <div className="text-[10px] text-text-tertiary text-center py-3">
          {t("waitingForCapabilities")}
        </div>
      </div>
    );
  }

  // Simplified card when NPU is not available
  if (!compute.npu_available) {
    return (
      <div className={cn("border border-border-default rounded-lg p-4", className)}>
        <div className="flex items-center gap-1.5 mb-3">
          <Cpu className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">{t("compute")}</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary/60 flex-shrink-0" />
            <span className="text-[10px] font-mono text-text-tertiary">
              {t("npuNotAvailable", { tier })}
            </span>
          </div>
          <p className="text-[10px] text-text-tertiary px-2">
            {t("npuRequirement")}
          </p>

          {/* Camera row still shown for boards without NPU */}
          {cameras.length > 0 && (
            <div className="pt-2 border-t border-border-default space-y-1.5">
              {cameras.map((cam, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-white/[0.02]">
                  <Camera size={10} className="text-text-tertiary flex-shrink-0" />
                  <span className="text-[10px] font-mono text-text-secondary truncate">
                    {cam.name}
                  </span>
                  <span className="text-[10px] font-mono text-text-tertiary ml-auto flex-shrink-0">
                    {cam.resolution}
                  </span>
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      cam.streaming ? "bg-status-success/80" : "bg-text-tertiary/60"
                    )}
                    title={cam.streaming ? t("streaming") : t("idle")}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const runtimeLabel = compute.npu_runtime
    ? RUNTIME_LABELS[compute.npu_runtime] ?? compute.npu_runtime
    : "Unknown";

  const vs = visionStateColor(vision.engine_state);
  const vsKey = visionStateKey(vision.engine_state);
  const vsLabel = vsKey ? t(vsKey) : vision.engine_state;

  const cachePercent =
    models.cache_max_mb > 0
      ? (models.cache_used_mb / models.cache_max_mb) * 100
      : 0;

  return (
    <div className={cn("border border-border-default rounded-lg p-4 space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">{t("compute")}</span>
        </div>
        <span className="text-[10px] font-mono text-text-tertiary">
          {t("tier", { tier })}
        </span>
      </div>

      {/* NPU row */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">{t("npu")}</span>
          <span className="text-[10px] font-mono text-text-primary">
            {compute.npu_tops.toFixed(1)} TOPS ({runtimeLabel})
          </span>
        </div>
        <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              npuBarColor(compute.npu_utilization_pct)
            )}
            style={{ width: `${Math.min(compute.npu_utilization_pct, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-text-tertiary">
          {t("utilization", { pct: compute.npu_utilization_pct.toFixed(1) })}
        </p>
      </div>

      {/* Inference row */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]">
        <Activity size={10} className="text-text-tertiary flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {vision.fps > 0 ? (
            <>
              <span className="text-[10px] font-mono text-text-primary">
                {t("inferenceStats", {
                  fps: vision.fps.toFixed(1),
                  ms: vision.inference_ms.toFixed(1),
                })}
              </span>
              {vision.model_loaded && (
                <p className="text-[10px] text-text-tertiary truncate">
                  {t("model", { name: vision.model_loaded })}
                </p>
              )}
            </>
          ) : (
            <span className="text-[10px] font-mono text-text-tertiary">
              {t("noInference")}
            </span>
          )}
        </div>
      </div>

      {/* Vision row */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]">
        <Eye size={10} className={cn("flex-shrink-0", vs.text)} />
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className={cn("text-[10px] font-mono flex items-center gap-1", vs.text)}>
            {vs.spinner && <Loader2 size={10} className="animate-spin" />}
            <span className={cn(vs.pulse && "animate-pulse")}>{vsLabel}</span>
          </span>
          {vision.active_behavior && (
            <span className="text-[10px] text-text-secondary truncate">
              {vision.active_behavior}
            </span>
          )}
        </div>
        {vision.track_count > 0 && (
          <span className="text-[10px] font-mono text-text-tertiary flex-shrink-0">
            {t("tracks", { count: vision.track_count })}
          </span>
        )}
      </div>

      {/* Models section */}
      {models.installed.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border-default">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <HardDrive size={10} className="text-text-tertiary" />
              <span className="text-[10px] text-text-secondary">{t("models")}</span>
            </div>
            <span className="text-[10px] font-mono text-text-tertiary">
              {models.cache_used_mb.toFixed(0)} / {models.cache_max_mb.toFixed(0)} MB
            </span>
          </div>
          <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                cachePercent >= 90
                  ? "bg-status-error"
                  : cachePercent >= 70
                    ? "bg-status-warning"
                    : "bg-accent-primary"
              )}
              style={{ width: `${Math.min(cachePercent, 100)}%` }}
            />
          </div>
          <div className="space-y-0.5">
            {models.installed.map((m) => (
              <div
                key={`${m.id}-${m.variant}`}
                className="flex items-center gap-2 px-2 py-0.5"
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full flex-shrink-0",
                    m.loaded ? "bg-status-success/80" : "bg-text-tertiary/60"
                  )}
                  title={m.loaded ? t("loaded") : t("installed")}
                />
                <span className="text-[10px] font-mono text-text-secondary truncate">
                  {m.id}/{m.variant}
                </span>
                <span className="text-[10px] font-mono text-text-tertiary ml-auto flex-shrink-0">
                  {m.size_mb.toFixed(0)} MB
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Camera row */}
      {cameras.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border-default">
          {cameras.map((cam, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-white/[0.02]">
              <Camera size={10} className="text-text-tertiary flex-shrink-0" />
              <span className="text-[10px] font-mono text-text-secondary truncate">
                {cam.name}
              </span>
              <span className="text-[10px] font-mono text-text-tertiary ml-auto flex-shrink-0">
                {cam.resolution}
              </span>
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  cam.streaming ? "bg-status-success/80" : "bg-text-tertiary/60"
                )}
                title={cam.streaming ? t("streaming") : t("idle")}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
