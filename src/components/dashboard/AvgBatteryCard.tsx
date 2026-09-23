"use client";

/**
 * @module dashboard/AvgBatteryCard
 * @description Fleet battery summary: average, lowest pack and low count.
 *
 * Only a current reading counts; which rows and packs qualify is decided once
 * by `selectFleetSummary`. With no reading at all the card says so instead of
 * showing 0% / 0.0V.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { selectFleetSummary } from "@/stores/node-registry/fleet-summary";
import { batteryBand, useBatteryThresholds } from "@/lib/battery-bands";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";

export function AvgBatteryCard() {
  const t = useTranslations("dashboard");
  const drones = useFleetStore((s) => s.drones);
  const profiles = useDroneMetadataStore((s) => s.profiles);
  const thresholds = useBatteryThresholds();

  const { reporting, averagePct, averageVoltage, lowest, lowCount } =
    selectFleetSummary(drones, thresholds).battery;

  if (averagePct === null || averageVoltage === null || lowest === null) {
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

  const lowestBand = batteryBand(lowest.remaining, thresholds);
  const lowestName = profiles[lowest.drone.id]?.displayName ?? lowest.drone.name;

  return (
    <Card title={t("avgBattery.title")}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-[11px] text-text-secondary">{t("avgBattery.average")}</span>
          <span className="text-[10px] text-text-tertiary ml-2 font-mono tabular-nums">
            {averageVoltage.toFixed(1)}V
          </span>
        </div>
        <span className="text-lg font-mono font-semibold text-text-primary tabular-nums">
          {Math.round(averagePct)}%
        </span>
      </div>
      <ProgressBar value={averagePct} showLabel={false} />
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
            {Math.round(lowest.remaining)}% / {lowest.voltage.toFixed(1)}V
          </span>
        </div>
      )}
    </Card>
  );
}
