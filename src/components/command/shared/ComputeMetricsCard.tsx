"use client";

import { Cpu, Eye, Camera, HardDrive, Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

interface ComputeMetricsCardProps {
  className?: string;
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

function visionStateLabel(state: string): string {
  switch (state) {
    case "off":
      return "Off";
    case "initializing":
      return "Initializing";
    case "ready":
      return "Ready";
    case "active":
      return "Active";
    case "degraded":
      return "Degraded";
    case "error":
      return "Error";
    default:
      return state;
  }
}

export function ComputeMetricsCard({ className }: ComputeMetricsCardProps) {
  const tier = useAgentCapabilitiesStore((s) => s.tier);
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const vision = useAgentCapabilitiesStore((s) => s.vision);
  const models = useAgentCapabilitiesStore((s) => s.models);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);

  if (!loaded) {
    return (
      <div className={cn("border border-border-default rounded-lg p-4", className)}>
        <div className="flex items-center gap-1.5 mb-3">
          <Cpu className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">Compute</span>
        </div>
        <div className="text-[10px] text-text-tertiary text-center py-3">
          Waiting for agent capabilities...
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
          <span className="text-xs font-medium text-text-secondary">Compute</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]">
            <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary/60 flex-shrink-0" />
            <span className="text-[10px] font-mono text-text-tertiary">
              NPU: Not available (Tier {tier} board)
            </span>
          </div>
          <p className="text-[10px] text-text-tertiary px-2">
            Vision and inference features require a Tier 3+ board with an NPU (RK3588, RK3576, or similar).
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
                      cam.streaming ? "bg-green-500/80" : "bg-gray-500/60"
                    )}
                    title={cam.streaming ? "Streaming" : "Idle"}
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
  const vsLabel = visionStateLabel(vision.engine_state);

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
          <span className="text-xs font-medium text-text-secondary">Compute</span>
        </div>
        <span className="text-[10px] font-mono text-text-tertiary">
          Tier {tier}
        </span>
      </div>

      {/* NPU row */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary">NPU</span>
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
          {compute.npu_utilization_pct.toFixed(1)}% utilization
        </p>
      </div>

      {/* Inference row */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02]">
        <Activity size={10} className="text-text-tertiary flex-shrink-0" />
        <div className="min-w-0 flex-1">
          {vision.fps > 0 ? (
            <>
              <span className="text-[10px] font-mono text-text-primary">
                {vision.fps.toFixed(1)} FPS / {vision.inference_ms.toFixed(1)}ms avg
              </span>
              {vision.model_loaded && (
                <p className="text-[10px] text-text-tertiary truncate">
                  Model: {vision.model_loaded}
                </p>
              )}
            </>
          ) : (
            <span className="text-[10px] font-mono text-text-tertiary">
              No active inference
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
            {vision.track_count} trk
          </span>
        )}
      </div>

      {/* Models section */}
      {models.installed.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border-default">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <HardDrive size={10} className="text-text-tertiary" />
              <span className="text-[10px] text-text-secondary">Models</span>
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
                    m.loaded ? "bg-green-500/80" : "bg-gray-500/60"
                  )}
                  title={m.loaded ? "Loaded" : "Installed"}
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
                  cam.streaming ? "bg-green-500/80" : "bg-gray-500/60"
                )}
                title={cam.streaming ? "Streaming" : "Idle"}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
