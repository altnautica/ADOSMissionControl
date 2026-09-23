"use client";

/**
 * @module vision/VisionModelCountTile
 * @description At-a-glance model tally for the Perception hub: how many models
 * are running (an active detection stream), how many the engine holds loaded,
 * and how many are loaded but idle (no live stream). Running comes from the
 * live detection streams; loaded / idle from the engine status read-back. With
 * no read-back the counts are unknown ("—"), never a measured 0.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";

import { useVisionPipelines } from "@/hooks/use-vision-pipelines";
import { useVisionEngineStatus } from "@/hooks/use-vision-engine-models";

function CountCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex-1 rounded border border-border-default bg-bg-primary px-3 py-2 text-center">
      <div className="font-mono text-lg tabular-nums text-text-primary">
        {value ?? "—"}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
    </div>
  );
}

export function VisionModelCountTile({ droneId }: { droneId: string }) {
  const t = useTranslations("vision");
  const pipelines = useVisionPipelines(droneId);
  const status = useVisionEngineStatus();

  const activeCount = pipelines.filter((p) => p.active).length;
  // A live stream proves a running model; with no stream and no engine
  // read-back the running count is not known either.
  const running = activeCount > 0 || status.known ? activeCount : null;
  // The engine's own count when it reports one, else the length of the model
  // list it returned (a real derived figure, never fabricated).
  const loaded = status.known
    ? Math.max(status.modelCount, status.models.length)
    : null;
  // Loaded models not carried by any active stream right now.
  const idle = useMemo(() => {
    if (!status.known) return null;
    const streaming = new Set(
      pipelines.filter((p) => p.active).map((p) => p.modelId),
    );
    return status.models.filter((m) => !streaming.has(m.id)).length;
  }, [pipelines, status]);

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-text-secondary">
        <Layers size={13} aria-hidden="true" />
        {t("modelCount")}
      </h3>
      <div className="flex gap-2">
        <CountCell label={t("modelsRunning")} value={running} />
        <CountCell label={t("modelsLoaded")} value={loaded} />
        <CountCell label={t("modelsIdle")} value={idle} />
      </div>
      {status.known ? null : (
        <p className="mt-2 text-[10px] text-text-tertiary">
          {t("engineStatusUnavailable")}
        </p>
      )}
    </section>
  );
}
