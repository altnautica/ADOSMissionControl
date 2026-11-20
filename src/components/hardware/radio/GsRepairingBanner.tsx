"use client";

/**
 * @module hardware/radio/GsRepairingBanner
 * @description Warning banner while the connected ground station re-pairs
 * because its drone is on the air with a different key: the agent's
 * auto-pair re-arm (`link.pair_rearm` on its `/status`) is running with
 * cause `mis_keyed`. The rule is the cockpit spec's `gs_repairing` alert.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { repairingMisKeyed } from "@/lib/hud/status-pill";
import { useGroundStationStore } from "@/stores/ground-station-store";

export function GsRepairingBanner() {
  const t = useTranslations("hardware.radio");
  const profile = useGroundStationStore((s) => s.status.profile);
  const rearm = useGroundStationStore((s) => s.status.pair_rearm);

  if (profile !== "ground_station" || !repairingMisKeyed(rearm)) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-status-warning/10 border-status-warning/30 text-status-warning"
    >
      <KeyRound size={16} className="shrink-0" />
      <p className="text-sm font-medium">{t("gsRepairing")}</p>
    </div>
  );
}
