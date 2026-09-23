"use client";

/**
 * @module vision/VisionPipelinesPanel
 * @description The vision hub's "pipelines running now" panel: one row per
 * active detection stream (model × camera) on the drone, so an operator sees
 * every perception pipeline running simultaneously with its live state — the
 * central-hub visibility the single-active-model summary never gave. Derived
 * from the live detection streams (`useVisionPipelines`); a stream that stops
 * publishing flips to a "stalled" state rather than lingering.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Activity, Layers, Moon } from "lucide-react";

import {
  useVisionPipelines,
  type VisionPipeline,
} from "@/hooks/use-vision-pipelines";
import { useVisionEngineStatus } from "@/hooks/use-vision-engine-models";
import type { EngineModel } from "@/lib/agent/vision-client";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import {
  executionTarget,
  type ExecutionTarget,
} from "@/lib/vision/perception-health";

function ageLabel(ms: number): string {
  if (ms < 1000) return "now";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/** Per-model inference metrics + honesty badge, shown only when the agent
 * forwards real values (no fabricated reading). A mock/CPU backend that reports
 * `isInferenceCapable === false` is badged as such rather than implying it
 * produces real detections. Renders nothing when there's nothing truthful. */
function ModelMetricsLine({ model }: { model?: EngineModel }) {
  const t = useTranslations("vision");
  if (!model) return null;
  const hasTiming =
    typeof model.fps === "number" || typeof model.latencyMs === "number";
  const notCapable = model.isInferenceCapable === false;
  if (!hasTiming && !notCapable) return null;
  return (
    <div className="mt-0.5 flex items-center gap-2">
      {hasTiming ? (
        <span className="font-mono text-[10px] tabular-nums text-text-tertiary">
          {t("fpsLatency", {
            fps: typeof model.fps === "number" ? model.fps.toFixed(1) : "—",
            ms:
              typeof model.latencyMs === "number"
                ? model.latencyMs.toFixed(0)
                : "—",
          })}
        </span>
      ) : null}
      {notCapable ? (
        <span className="rounded border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-status-warning">
          {t("notInferenceCapable")}
        </span>
      ) : null}
    </div>
  );
}

/** Where a pipeline's detection runs — local (on-edge), offload ‹target›, or
 * auto (hybrid) — derived from the node's resolved perception tier. Hidden when
 * the tier is unknown so a target is never fabricated (no fabricated reading). */
function ExecTargetBadge({ exec }: { exec: ExecutionTarget | null }) {
  const t = useTranslations("vision");
  if (!exec) return null;
  return (
    <span
      className="inline-flex items-center rounded border border-border-default bg-bg-tertiary/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-tertiary"
      data-testid="exec-target-badge"
      data-exec-kind={exec.kind}
    >
      {t(`execTarget_${exec.kind}` as const)}
      {exec.kind === "offload" && exec.detail ? (
        <span className="ml-1 font-mono normal-case tracking-normal text-text-secondary">
          · {exec.detail}
        </span>
      ) : null}
    </span>
  );
}

function PipelineRow({
  p,
  model,
  exec,
  selected,
  onSelect,
}: {
  p: VisionPipeline;
  /** The engine model matching this pipeline's modelId, for fps/latency. */
  model?: EngineModel;
  /** Where this pipeline's detection runs (node-level tier). */
  exec: ExecutionTarget | null;
  selected: boolean;
  onSelect?: (key: string) => void;
}) {
  const color = p.active
    ? "var(--status-success, #22c55e)"
    : "var(--status-warning, #f59e0b)";
  const clickable = onSelect != null;
  return (
    <div
      className={`flex items-center gap-3 rounded border px-3 py-2 ${
        selected
          ? "border-accent-primary bg-accent-primary/10"
          : "border-border-default bg-bg-primary"
      } ${clickable ? "cursor-pointer hover:border-accent-primary/60" : ""}`}
      data-testid="vision-pipeline-row"
      data-active={p.active}
      data-selected={selected}
      onClick={clickable ? () => onSelect(p.key) : undefined}
      role={clickable ? "button" : undefined}
      aria-pressed={clickable ? selected : undefined}
      title={clickable ? "Preview this pipeline" : undefined}
    >
      <span
        className="h-2 w-2 flex-none rounded-full"
        style={{ background: color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-text-primary">
          {p.modelId}
        </div>
        <div className="font-mono text-[10px] text-text-tertiary">
          {p.cameraId}
        </div>
        <ModelMetricsLine model={model} />
        <div className="mt-0.5">
          <ExecTargetBadge exec={exec} />
        </div>
      </div>
      <div className="text-right font-mono">
        <div className="text-xs tabular-nums text-text-primary">
          {p.detectionCount}
          {p.lockedCount > 0 ? (
            <span style={{ color: "var(--status-success, #22c55e)" }}>
              {" "}
              ·{p.lockedCount}🔒
            </span>
          ) : null}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
          {ageLabel(p.ageMs)}
        </div>
      </div>
    </div>
  );
}

/** A model the engine has loaded but that is publishing nothing right now
 * (registered, no live stream) — shown so the operator sees the whole model
 * set, not only what happens to be producing detections this instant. */
function IdleModelRow({
  m,
  exec,
}: {
  m: EngineModel;
  exec: ExecutionTarget | null;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded border border-border-default bg-bg-primary/60 px-3 py-2"
      data-testid="vision-idle-model-row"
      data-model-id={m.id}
    >
      <Moon
        size={12}
        className="flex-none text-text-tertiary"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-text-secondary">
          {m.id}
        </div>
        <div className="font-mono text-[10px] text-text-tertiary">
          {[m.kind, m.execution].filter(Boolean).join(" · ")}
        </div>
        <ModelMetricsLine model={m} />
        <div className="mt-0.5">
          <ExecTargetBadge exec={exec} />
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
        {m.backendLoaded ? "loaded" : "registered"}
      </span>
    </div>
  );
}

export function VisionPipelinesPanel({
  droneId,
  selectedKey,
  onSelect,
}: {
  droneId: string;
  /** The pipeline stream (`modelId::cameraId`) currently pinned in the preview,
   * or null when the preview follows the latest batch. */
  selectedKey?: string | null;
  /** Select a pipeline to preview. When absent the rows are read-only. */
  onSelect?: (key: string) => void;
}) {
  const t = useTranslations("vision");
  const pipelines = useVisionPipelines(droneId);
  const engineStatus = useVisionEngineStatus();
  const engineModels = engineStatus.models;
  const runningCount = pipelines.filter((p) => p.active).length;

  // Where detection runs for this node (tier-derived), stamped onto every row.
  const tier = useAgentCapabilitiesStore((s) => s.perceptionTier);
  const offloadTarget = useAgentCapabilitiesStore(
    (s) => s.perceptionOffloadTarget,
  );
  const exec = useMemo(
    () => executionTarget(tier, offloadTarget),
    [tier, offloadTarget],
  );

  // Index the engine models by id so each pipeline row can show the fps/latency
  // + inference-capability of the model producing it.
  const modelById = useMemo(
    () => new Map(engineModels.map((m) => [m.id, m])),
    [engineModels],
  );

  // A model is "idle" when the engine holds it but no live stream carries it.
  const idleModels = useMemo(() => {
    const streaming = new Set(pipelines.map((p) => p.modelId));
    return engineModels.filter((m) => !streaming.has(m.id));
  }, [engineModels, pipelines]);

  const isEmpty = pipelines.length === 0 && idleModels.length === 0;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-text-secondary">
          <Layers size={13} aria-hidden="true" />
          {t("pipelines")}
        </h3>
        <span className="flex items-center gap-1 font-mono text-[10px] text-text-tertiary">
          <Activity size={11} aria-hidden="true" />
          {t("pipelinesRunning", { count: runningCount })}
        </span>
      </div>
      {isEmpty ? (
        <p className="py-4 text-center text-[11px] text-text-tertiary">
          {/* With no engine read-back an empty list is "not known", not "none". */}
          {engineStatus.known ? t("noPipelines") : t("engineStatusUnavailable")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {pipelines.map((p) => (
            <PipelineRow
              key={p.key}
              p={p}
              model={modelById.get(p.modelId)}
              exec={exec}
              selected={selectedKey === p.key}
              onSelect={onSelect}
            />
          ))}
          {idleModels.map((m) => (
            <IdleModelRow key={`idle:${m.id}`} m={m} exec={exec} />
          ))}
        </div>
      )}
    </section>
  );
}
