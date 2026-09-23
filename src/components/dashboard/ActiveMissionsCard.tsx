"use client";

import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { selectFleetSummary } from "@/stores/node-registry/fleet-summary";
import { useBatteryThresholds } from "@/lib/battery-bands";
import { Card } from "@/components/ui/card";

export function ActiveMissionsCard() {
  const t = useTranslations("dashboard");
  const drones = useFleetStore((s) => s.drones);
  // An FC that stopped talking is not known to be in a mission, but it is not
  // known to be down either: it is listed as link lost rather than dropped.
  const { inFlight, linkLost } = selectFleetSummary(drones, useBatteryThresholds());

  return (
    <Card title={t("activeMissions.title")}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-text-secondary">{t("activeMissions.inFlight")}</span>
        <span className="text-lg font-mono font-semibold text-text-primary tabular-nums">
          {inFlight.length}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {inFlight.length === 0 && linkLost.length === 0 && (
          <span className="text-xs text-text-tertiary">{t("activeMissions.noActiveMissions")}</span>
        )}
        {inFlight.map((d) => (
          <div key={d.id} className="flex items-center justify-between">
            <span className="text-xs text-text-secondary truncate">{d.name}</span>
            <span className="text-[10px] font-mono text-text-tertiary tabular-nums">
              {d.flightMode}
            </span>
          </div>
        ))}
        {linkLost.map((d) => (
          <div key={d.id} className="flex items-center justify-between">
            <span className="text-xs text-text-secondary truncate">{d.name}</span>
            <span className="text-[10px] font-mono text-status-error">LINK LOST</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
