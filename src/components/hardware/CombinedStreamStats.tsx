"use client";

/**
 * @module CombinedStreamStats
 * @description Receiver-side combined FEC output stats: post-dedup
 * fragment count, FEC-repaired fragments, output bitrate.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";

export function CombinedStreamStats() {
  const t = useTranslations("hardware.distributedRx");
  const combined = useGroundStationStore((s) => s.distributedRx.combined);

  if (!combined) {
    return (
      <div className="p-4 bg-surface-primary border border-border-default/40">
        <div className="text-sm text-text-tertiary italic">{t("combinedEmpty")}</div>
      </div>
    );
  }

  const fmt = (v: number | null) => (v === null ? "--" : v.toLocaleString());
  return (
    <div className="p-4 bg-surface-primary border border-border-default/40">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-text-primary">{t("combinedTitle")}</div>
        {combined.stale && (
          <div className="text-xs text-status-warning">{t("staleSnapshot")}</div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
            {t("fragmentsAfterDedup")}
          </div>
          <div className="font-mono text-lg text-text-primary">
            {fmt(combined.fragments_after_dedup)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
            {t("fecRepaired")}
          </div>
          <div className="font-mono text-lg text-text-primary">
            {fmt(combined.fec_repaired)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
            {t("outputBitrate")}
          </div>
          <div className="font-mono text-lg text-text-primary">
            {fmt(combined.output_kbps)} <span className="text-xs text-text-tertiary">kbps</span>
          </div>
        </div>
      </div>
    </div>
  );
}
