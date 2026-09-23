"use client";

/**
 * @module PairedDroneCard
 * @description Shows which drone the ground station is currently paired to
 * (the WFB-ng radio peer). Reads the link slice's `status.paired_drone`, which
 * the overview's status poll and the cloud heartbeat refresh. A status that was
 * never read says so rather than claiming the node is unpaired, and a status
 * that stopped refreshing is dimmed and marked stale.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { GsFreshnessBadge, useGsSliceFreshness } from "./gs-slice-freshness";

export function PairedDroneCard() {
  const t = useTranslations("groundStationOverview.pairedDrone");
  const pairedDrone = useGroundStationStore((s) => s.status.paired_drone);
  const statusFetchedAt = useGroundStationStore((s) => s.statusFetchedAt);
  const freshness = useGsSliceFreshness(statusFetchedAt);

  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary p-3 space-y-1">
      <h3 className="text-xs uppercase tracking-wide text-text-tertiary flex items-center gap-2">
        {t("title")}
        <GsFreshnessBadge freshness={freshness} />
      </h3>
      {freshness === "unread" ? (
        <p className="text-xs text-text-tertiary">{t("unknown")}</p>
      ) : pairedDrone ? (
        <p
          className={cn(
            "text-sm font-mono text-text-primary truncate",
            freshness === "stale" && "opacity-60",
          )}
        >
          {pairedDrone}
        </p>
      ) : (
        <p className={cn("text-xs text-text-tertiary", freshness === "stale" && "opacity-60")}>
          {t("unpaired")}
        </p>
      )}
    </div>
  );
}
