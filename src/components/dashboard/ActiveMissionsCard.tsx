"use client";

import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { Card } from "@/components/ui/card";
import type { SuiteType } from "@/lib/types";

const suiteColors: Record<SuiteType, string> = {
  sentry: "bg-accent-primary",
  survey: "bg-accent-secondary",
  agriculture: "bg-status-success",
  cargo: "bg-status-warning",
  sar: "bg-status-error",
  inspection: "bg-[#a855f7]",
};

export function ActiveMissionsCard() {
  const t = useTranslations("dashboard");
  const drones = useFleetStore((s) => s.drones);
  const inFlight = drones.filter((d) => d.status === "in_mission");

  const suiteLabels: Record<SuiteType, string> = {
    sentry: t("activeMissions.suites.sentry"),
    survey: t("activeMissions.suites.survey"),
    agriculture: t("activeMissions.suites.agriculture"),
    cargo: t("activeMissions.suites.cargo"),
    sar: t("activeMissions.suites.sar"),
    inspection: t("activeMissions.suites.inspection"),
  };

  const bySuite = inFlight.reduce<Partial<Record<SuiteType, number>>>((acc, d) => {
    if (d.suiteType) {
      acc[d.suiteType] = (acc[d.suiteType] || 0) + 1;
    }
    return acc;
  }, {});

  return (
    <Card title={t("activeMissions.title")}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-text-secondary">{t("activeMissions.inFlight")}</span>
        <span className="text-lg font-mono font-semibold text-text-primary tabular-nums">
          {inFlight.length}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {(Object.entries(bySuite) as [SuiteType, number][]).map(([suite, count]) => (
          <div key={suite} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 ${suiteColors[suite]}`} />
              <span className="text-xs text-text-secondary">{suiteLabels[suite]}</span>
            </div>
            <span className="text-xs font-mono text-text-primary tabular-nums">{count}</span>
          </div>
        ))}
        {Object.keys(bySuite).length === 0 && (
          <span className="text-xs text-text-tertiary">{t("activeMissions.noActiveMissions")}</span>
        )}
      </div>
    </Card>
  );
}
