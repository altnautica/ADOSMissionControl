"use client";

import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import type { DroneStatus } from "@/lib/types";

const statusDotMap: Record<DroneStatus, "online" | "idle" | "warning" | "error" | "offline"> = {
  online: "online",
  in_mission: "online",
  idle: "idle",
  returning: "warning",
  maintenance: "error",
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

  const counts = drones.reduce<Partial<Record<DroneStatus, number>>>((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});

  const statuses: DroneStatus[] = ["in_mission", "online", "idle", "returning", "maintenance", "offline"];

  return (
    <Card title={t("fleetStatus.title")}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-text-secondary">{t("fleetStatus.totalDrones")}</span>
        <span className="text-lg font-mono font-semibold text-text-primary tabular-nums">
          {drones.length}
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
      </div>
    </Card>
  );
}
