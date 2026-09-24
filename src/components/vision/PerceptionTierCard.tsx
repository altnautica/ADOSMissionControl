"use client";

/**
 * @module vision/PerceptionTierCard
 * @description The Perception hub's execution-tier surface. Shows the tier the
 * agent resolved for this node — local (on the node's NPU), offload (to a
 * workstation), hybrid, or none — with the accelerator rationale behind it.
 * The tier + the current offload target are read from the heartbeat (honest
 * status, never fabricated). Choosing the offload workstation belongs to the
 * World Engine extension, which owns the offload lane.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Cpu, Layers } from "lucide-react";

import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import { perceptionFeedState } from "@/lib/vision/perception-health";

type Tier = "local" | "offload" | "hybrid" | "none" | "unknown";

const TIER_STYLE: Record<Tier, string> = {
  local: "border-status-success/40 bg-status-success/10 text-status-success",
  offload: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  hybrid: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  none: "border-border-default bg-bg-tertiary text-text-tertiary",
  unknown: "border-border-default bg-bg-tertiary text-text-tertiary",
};

interface PerceptionTierCardProps {
  droneId: string;
}

export function PerceptionTierCard({ droneId }: PerceptionTierCardProps) {
  const t = useTranslations("vision");

  const perceptionTier = useAgentCapabilitiesStore((s) => s.perceptionTier);
  const offloadTarget = useAgentCapabilitiesStore(
    (s) => s.perceptionOffloadTarget,
  );
  // Live return-stream health for the offload path — the same freshness the
  // cockpit chip and session card read, surfaced here on the tier card too.
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const [now, setNow] = useState(() => Date.now());
  // Key on whether a feed EXISTS, not the batch object (replaced every frame,
  // ~10-15 Hz), so the 500 ms staleness interval is created once per feed
  // lifecycle instead of torn down + recreated on every batch.
  const hasFeed = !!batch;
  useEffect(() => {
    if (!hasFeed) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [hasFeed]);
  const feed = perceptionFeedState(batch, now);
  const npuTops = useAgentCapabilitiesStore((s) => s.npuTops);
  const hasAccelerator = useAgentCapabilitiesStore((s) => s.hasAccelerator);
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const capsLoaded = useAgentCapabilitiesStore((s) => s.loaded);

  const tier: Tier = perceptionTier ?? "unknown";
  // Fall back to the compute block when the top-level mirrors are absent. Until
  // the first capabilities payload lands the compute block is the empty
  // default, which is not a report of "no accelerator".
  const acceleratorPresent: boolean | null =
    hasAccelerator ??
    (capsLoaded ? compute.npu_available || compute.gpu_available : null);
  const tops = npuTops ?? compute.npu_tops;
  let acceleratorLine: string;
  if (acceleratorPresent === null) acceleratorLine = t("acceleratorNotReported");
  else if (!acceleratorPresent) acceleratorLine = t("acceleratorNone");
  // A GPU-only node reports no NPU TOPS; never render that as "0.0 TOPS".
  else if (tops > 0) acceleratorLine = t("acceleratorPresent", { tops: tops.toFixed(1) });
  else acceleratorLine = t("acceleratorPresentNoTops");

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Layers size={16} className="text-accent-primary" aria-hidden="true" />
        <h2 className="text-lg font-medium text-text-primary">
          {t("perceptionTier")}
        </h2>
        <div className="flex-1" />
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium ${TIER_STYLE[tier]}`}
        >
          {t(`tier_${tier}` as const)}
        </span>
      </div>

      <p className="mb-3 text-xs text-text-secondary">
        {t(`tierHint_${tier}` as const)}
      </p>

      {/* Why the tier resolved as it did — the accelerator posture. */}
      <div className="mb-4 flex items-center gap-2 rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2">
        <Cpu size={12} className="flex-none text-text-tertiary" aria-hidden="true" />
        <span className="text-[11px] text-text-secondary">
          {acceleratorLine}
        </span>
      </div>

      {offloadTarget ? (
        <div className="mb-4 text-[11px] text-text-tertiary">
          {t("offloadTargetActive", { target: offloadTarget })}
        </div>
      ) : null}

      {/* Offload return-stream health — is detection actually flowing back. */}
      {tier === "offload" ? (
        <div className="mb-4 flex items-center gap-1.5 text-[11px]">
          <span
            className={`h-2 w-2 flex-none rounded-full ${
              feed === "fresh"
                ? "bg-status-success"
                : feed === "stale"
                  ? "bg-status-warning"
                  : "bg-text-tertiary"
            }`}
            aria-hidden="true"
          />
          <span
            className={
              feed === "stale" ? "text-status-warning" : "text-text-secondary"
            }
          >
            {feed === "fresh"
              ? t("offloadHealthLive")
              : feed === "stale"
                ? t("offloadHealthStale")
                : t("offloadHealthIdle")}
          </span>
        </div>
      ) : null}
    </section>
  );
}
