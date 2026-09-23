"use client";

/**
 * @module vision/PerceptionSessionCard
 * @description The Perception hub's live perception-OFFLOAD session surface —
 * the long-lived open→flow→close stream state, distinct from the tier card's
 * one-shot "Run now" job control. It answers "is this drone's perception feed
 * actually flowing, from where, and how fast" by reading the live detection
 * feed (freshness + receipt-timestamp throughput) and the resolved tier:
 *
 *   - Session state (opening / live / stalled / closed) from feed freshness +
 *     the tier, so a feed that WAS flowing and stopped reads "stalled" rather
 *     than silently as "no targets" (no fabricated reading).
 *   - Bound node — the offload workstation when the tier is offload.
 *   - Return-stream freshness — ms since the last batch, with a green/amber dot.
 *   - Throughput — batches/sec over a rolling window, shown ONLY while the
 *     session is live (never a fabricated or stale rate).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Radio } from "lucide-react";

import {
  batchesPerSecond,
  perceptionFeedState,
  perceptionSessionState,
  THROUGHPUT_WINDOW_MS,
  type PerceptionSessionState,
} from "@/lib/vision/perception-health";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const SESSION_STYLE: Record<PerceptionSessionState, string> = {
  live: "border-status-success/40 bg-status-success/10 text-status-success",
  opening: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  stalled: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  closed: "border-border-default bg-bg-tertiary text-text-tertiary",
};

export function PerceptionSessionCard({ droneId }: { droneId: string }) {
  const t = useTranslations("vision");
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const tier = useAgentCapabilitiesStore((s) => s.perceptionTier);
  const target = useAgentCapabilitiesStore((s) => s.perceptionOffloadTarget);

  const [clock, setClock] = useState<{ now: number; rate: number | null }>(() => ({
    now: Date.now(),
    rate: null,
  }));
  const now = clock.now;

  // Tick only while a feed has started, so the readout ages fresh → stale and
  // the throughput updates on its own even with no new batch. Idle costs
  // nothing (opening/closed are static states). Key the effect on whether a
  // feed EXISTS, not the batch object: the batch ref is replaced every frame
  // (~10-15 Hz), so keying on it would tear down + recreate the 500 ms interval
  // each frame instead of once per feed lifecycle. The throughput is computed
  // here on the tick, not in render, so the receipt-time copy happens twice a
  // second rather than on every batch.
  const hasFeed = !!batch;
  useEffect(() => {
    if (!hasFeed) return;
    const id = setInterval(() => {
      const at = Date.now();
      setClock({
        now: at,
        rate: batchesPerSecond(
          useVisionDetectionsStore.getState().receiptTimes(droneId),
          at,
          THROUGHPUT_WINDOW_MS,
        ),
      });
    }, 500);
    return () => clearInterval(id);
  }, [hasFeed, droneId]);

  const feed = perceptionFeedState(batch, now);
  const session = perceptionSessionState(feed, tier);

  // Throughput only matters (and is only truthful) while the feed is live.
  const rate = feed === "fresh" ? clock.rate : null;

  const boundNode =
    tier === "offload"
      ? (target ?? t("sessionBoundNone"))
      : tier === "local" || tier === "hybrid"
        ? t("sessionBoundLocal")
        : t("sessionBoundNone");
  const boundMono = tier === "offload" && !!target;

  const ageMs = batch ? Math.max(0, now - batch.receivedAt) : null;
  const dotClass =
    feed === "fresh"
      ? "bg-status-success"
      : feed === "stale"
        ? "bg-status-warning"
        : "bg-text-tertiary";

  return (
    <section
      className="rounded border border-border-default bg-bg-secondary p-5"
      data-testid="perception-session-card"
      data-session-state={session}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Radio size={16} className="text-accent-primary" aria-hidden="true" />
        <h2 className="text-lg font-medium text-text-primary">
          {t("perceptionSession")}
        </h2>
        <div className="flex-1" />
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium ${SESSION_STYLE[session]}`}
        >
          {t(`sessionState_${session}` as const)}
        </span>
      </div>

      <p className="mb-4 text-xs text-text-secondary">
        {t(`sessionStateHint_${session}` as const)}
      </p>

      <dl className="flex flex-col gap-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-tertiary">{t("sessionBoundNode")}</dt>
          <dd
            className={`truncate text-right text-text-primary ${
              boundMono ? "font-mono" : ""
            }`}
          >
            {boundNode}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-tertiary">{t("sessionReturnStream")}</dt>
          <dd className="flex items-center gap-1.5 text-right text-text-primary">
            <span
              className={`h-2 w-2 flex-none rounded-full ${dotClass}`}
              aria-hidden="true"
            />
            <span className="tabular-nums">
              {ageMs == null
                ? t("sessionFeedNone")
                : t("sessionFeedAge", { age: (ageMs / 1000).toFixed(1) })}
            </span>
          </dd>
        </div>

        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-tertiary">{t("sessionThroughput")}</dt>
          <dd className="text-right font-mono tabular-nums text-text-primary">
            {session === "live" && rate != null
              ? t("sessionBatchesPerSec", { rate: rate.toFixed(1) })
              : t("sessionThroughputIdle")}
          </dd>
        </div>
      </dl>
    </section>
  );
}
