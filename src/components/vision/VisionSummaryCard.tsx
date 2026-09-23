"use client";

/**
 * @module VisionSummaryCard
 * @description Live vision-engine summary for a single drone. Reads the
 * compact summary the agent forwards each heartbeat (active model id,
 * inference backend, detections/sec, frame rate) plus the last-frame age
 * derived from the latest detection batch in the detections store.
 *
 * Renders an idle state when no model is loaded so the card is always
 * informative even on a vision-capable drone that is not actively
 * running inference.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Eye } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

interface VisionSummaryCardProps {
  droneId: string;
}

const EMPTY = "…";

/** Backend label. Free-form value from the agent; map the known ones to
 * a friendlier name and pass anything else through verbatim. */
function backendLabel(backend: string | null | undefined): string | null {
  if (!backend) return null;
  if (backend === "ort") return "ONNX Runtime";
  if (backend === "rknn") return "RKNN NPU";
  if (backend === "mock") return "Mock";
  return backend;
}

export function VisionSummaryCard({ droneId }: VisionSummaryCardProps) {
  const t = useTranslations("vision");
  const summary = useAgentCapabilitiesStore((s) => s.visionSummary);
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);

  const activeModel = summary?.activeModel ?? null;
  const backend = backendLabel(summary?.backend);
  const detsPerSec = summary?.detectionsPerSec;
  const fps = summary?.fps;
  const isActive = !!activeModel;

  // Ticking clock so "last frame Xs ago" advances on its own. Reading
  // the wall clock from state (not Date.now() in render) keeps render
  // pure.
  // Keyed on whether a feed exists, not on the batch object that is replaced
  // every frame, so the interval lives for the feed's lifetime.
  const [now, setNow] = useState(() => Date.now());
  const hasFeed = !!batch;
  useEffect(() => {
    if (!hasFeed) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasFeed]);

  // The clock ticks once a second, so a batch can be newer than `now`.
  const lastFrameAgeMs = batch ? Math.max(0, now - batch.receivedAt) : null;
  const lastFrameLabel =
    lastFrameAgeMs == null
      ? EMPTY
      : lastFrameAgeMs < 1000
        ? t("lastFrameNow")
        : t("lastFrameAgo", { seconds: Math.round(lastFrameAgeMs / 1000) });

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
            isActive
              ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
              : "border-border-default bg-bg-tertiary text-text-secondary"
          }`}
        >
          <Eye size={12} />
          {isActive ? t("engineActive") : t("engineIdle")}
        </span>
        {backend ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-border-default bg-bg-tertiary px-2.5 py-1 text-xs text-text-tertiary">
            {t("backend", { backend })}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <StatRow
          label={t("activeModel")}
          value={activeModel ?? EMPTY}
          mono
        />
        <StatRow
          label={t("detectionsPerSec")}
          value={detsPerSec == null ? EMPTY : detsPerSec.toFixed(1)}
        />
        <StatRow
          label={t("fps")}
          value={fps == null ? EMPTY : fps.toFixed(1)}
        />
        <StatRow label={t("lastFrame")} value={lastFrameLabel} />
      </dl>
    </section>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function StatRow({ label, value, mono }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-default py-1.5">
      <dt className="text-xs uppercase tracking-wide text-text-secondary">
        {label}
      </dt>
      <dd
        className={`text-sm text-text-primary ${mono ? "font-mono" : "tabular-nums"}`}
      >
        {value}
      </dd>
    </div>
  );
}
