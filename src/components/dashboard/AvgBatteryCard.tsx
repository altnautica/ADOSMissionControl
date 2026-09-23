"use client";

/**
 * @module dashboard/AvgBatteryCard
 * @description Fleet battery summary: average, lowest pack and low count.
 *
 * Only a current reading counts. A row whose flight controller is absent,
 * silent or offline contributes nothing, and a pack the FC reports as unknown
 * (remaining < 0) is left out of the average, the minimum and the low count.
 * With no reading at all the card says so instead of showing 0% / 0.0V.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { hasLiveFcReading } from "@/stores/node-registry/select-fleet-drones";
import { batteryBand, useBatteryThresholds } from "@/lib/battery-bands";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";

export function AvgBatteryCard() {
  const t = useTranslations("dashboard");
  const drones = useFleetStore((s) => s.drones);
  const profiles = useDroneMetadataStore((s) => s.profiles);
  const thresholds = useBatteryThresholds();

  const reporting = drones.flatMap((d) =>
    hasLiveFcReading(d) && d.battery && d.battery.remaining >= 0
      ? [{ drone: d, battery: d.battery }]
      : [],
  );

  if (reporting.length === 0) {
    return (
      <Card title={t("avgBattery.title")}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-tertiary">
            {t("avgBattery.noneReporting")}
          </span>
          <span className="text-lg font-mono font-semibold text-text-tertiary">—</span>
        </div>
      </Card>
    );
  }

  const avgBattery =
    reporting.reduce((sum, r) => sum + r.battery.remaining, 0) / reporting.length;
  const avgVoltage =
    reporting.reduce((sum, r) => sum + r.battery.voltage, 0) / reporting.length;
  const lowest = reporting.reduce((min, r) =>
    r.battery.remaining < min.battery.remaining ? r : min,
  );
  const lowCount = reporting.filter((r) => {
    const band = batteryBand(r.battery.remaining, thresholds);
    return band === "warning" || band === "critical";
  }).length;
  const lowestBand = batteryBand(lowest.battery.remaining, thresholds);
  const lowestName = profiles[lowest.drone.id]?.displayName ?? lowest.drone.name;

  return (
    <Card title={t("avgBattery.title")}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-[11px] text-text-secondary">{t("avgBattery.average")}</span>
          <span className="text-[10px] text-text-tertiary ml-2 font-mono tabular-nums">
            {avgVoltage.toFixed(1)}V
          </span>
        </div>
        <span className="text-lg font-mono font-semibold text-text-primary tabular-nums">
          {Math.round(avgBattery)}%
        </span>
      </div>
      <ProgressBar value={avgBattery} showLabel={false} />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-text-tertiary">
          {t("avgBattery.lowCount", { count: lowCount })}
        </span>
        <span className="text-[10px] text-text-tertiary">
          {t("avgBattery.reportingCount", { count: reporting.length })}
        </span>
      </div>
      {lowestName && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-default">
          <span className="text-[10px] text-text-tertiary truncate mr-2">
            {t("avgBattery.lowestLabel", { name: lowestName })}
          </span>
          <span
            className={`text-[10px] font-mono tabular-nums ${
              lowestBand === "critical"
                ? "text-status-error"
                : lowestBand === "warning"
                  ? "text-status-warning"
                  : "text-text-secondary"
            }`}
          >
            {Math.round(lowest.battery.remaining)}% / {lowest.battery.voltage.toFixed(1)}V
          </span>
        </div>
      )}
    </Card>
  );
}
