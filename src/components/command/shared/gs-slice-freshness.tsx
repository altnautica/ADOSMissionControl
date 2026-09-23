"use client";

/**
 * @module command/shared/gs-slice-freshness
 * @description How current one ground-station store slice is.
 *
 * The ground-station store keeps every slice's last value after the node stops
 * answering, and several slices have no writer at all until a tab that loads
 * them is opened. A card that renders a slice as-is therefore shows a snapshot
 * of unknown age, or an initial default that was never read from the node, as
 * the node's current state. Each slice carries the time it was last refreshed;
 * this resolves that stamp to fresh / stale / never read on the shared clock.
 *
 * The window is the cloud status row's maximum age. It covers both writers: the
 * overview's LAN poll lands every few seconds, and the cloud heartbeat fan-out
 * is the slower of the two.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useClockTick } from "@/lib/agent/freshness";
import { isDemoMode } from "@/lib/utils";
import { CLOUD_ROW_MAX_AGE_MS } from "@/components/hardware/radio/cloud-radio";

export type GsSliceFreshness = "fresh" | "stale" | "unread";

/**
 * The slice's freshness, re-evaluated every second so a card ages out on its
 * own. Demo mode seeds the store once and never refreshes it, so it reads fresh.
 */
export function useGsSliceFreshness(fetchedAt: number | null): GsSliceFreshness {
  useClockTick();
  if (isDemoMode()) return "fresh";
  if (fetchedAt === null || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return "unread";
  }
  return Date.now() - fetchedAt <= CLOUD_ROW_MAX_AGE_MS ? "fresh" : "stale";
}

/** Header chip naming why a card's values are not a current reading. */
export function GsFreshnessBadge({ freshness }: { freshness: GsSliceFreshness }) {
  const t = useTranslations("groundStationOverview.freshness");
  if (freshness === "fresh") return null;
  return (
    <span className="rounded border border-status-warning/40 bg-status-warning/10 px-1.5 py-0.5 text-[10px] normal-case text-status-warning">
      {freshness === "unread" ? t("notRead") : t("stale")}
    </span>
  );
}
