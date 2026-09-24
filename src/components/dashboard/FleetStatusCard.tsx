"use client";

import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { selectFleetSummary } from "@/stores/node-registry/fleet-summary";
import { useBatteryThresholds } from "@/lib/battery-bands";
import { Card } from "@/components/ui/card";
import type { StatusLevel } from "@/lib/status-level";
import { StatusDot } from "@/components/ui/status-dot";
import type { DroneStatus } from "@/lib/types";

const statusDotMap: Record<DroneStatus, StatusLevel> = {
  online: "good",
  in_mission: "good",
  idle: "idle",
  returning: "warning",
  maintenance: "critical",
  offline: "offline",
};

export function FleetStatusCard() {
  const t = useTranslations("dashboard");
  const drones = useFleetStore((s) => s.drones);

  const statusLabels: Record<DroneStatus, string> = {
    online: t("fleetStatus.statuses.online"),
    in_mission: t("fleetStatus.statuses.inMission"),
    idle: t("fleetStatus.statuses.idle"),
    returning: t("fleetStatus.statuses.returning"),
    maintenance: t("fleetStatus.statuses.maintenance"),
    offline: t("fleetStatus.statuses.offline"),
  };

  const {
    statusCounts: counts,
    gpsDeniedCount,
    linkLost,
    total,
  } = selectFleetSummary(drones, useBatteryThresholds());
  // Counted under their node's liveness above, but their FC went silent: the
  // operator has to see that no arm or mission state stands behind them.
  const linkLostCount = linkLost.length;

  const statuses: DroneStatus[] = ["in_mission", "online", "idle", "returning", "maintenance", "offline"];

  return (
    <Card title={t("fleetStatus.title")}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-text-secondary">{t("fleetStatus.totalDrones")}</span>
        <span className="text-lg font-mono font-semibold text-text-primary tabular-nums">
          {total}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {statuses.map((status) => {
          const count = counts[status] || 0;
          if (count === 0) return null;
          return (
            <div key={status} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={statusDotMap[status]} />
                <span className="text-xs text-text-secondary">{statusLabels[status]}</span>
              </div>
              <span className="text-xs font-mono text-text-primary tabular-nums">{count}</span>
            </div>
          );
        })}
        {linkLostCount > 0 && (
          <div className="flex items-center justify-between border-t border-border-default/40 mt-1 pt-1.5">
            <div className="flex items-center gap-2">
              <StatusDot status="critical" />
              <span className="text-xs text-text-secondary">FC link lost</span>
            </div>
            <span className="text-xs font-mono text-text-primary tabular-nums">
              {linkLostCount}
            </span>
          </div>
        )}
        {gpsDeniedCount > 0 && (
          <div className="flex items-center justify-between border-t border-border-default/40 mt-1 pt-1.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex h-2 w-2 rounded-full bg-accent-primary"
              />
              <span className="text-xs text-text-secondary">GPS-denied</span>
            </div>
            <span className="text-xs font-mono text-text-primary tabular-nums">
              {gpsDeniedCount}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
