"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import { DataValue } from "@/components/ui/data-value";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { SuiteType } from "@/lib/types";
import { cn } from "@/lib/utils";

function SentryDashboard({ progress }: { progress: number }) {
  const t = useTranslations("flight.suiteDashboard");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
          {t("patrolProgress")}
        </span>
        <ProgressBar value={progress} showLabel />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DataValue label={t("areaCovered")} value="1.2" unit="km\u00B2" />
        <DataValue label={t("laps")} value="3" />
        <DataValue label={t("detections")} value="0" />
        <DataValue label={t("alerts")} value="0" />
      </div>
    </div>
  );
}

function SurveyDashboard({ progress }: { progress: number }) {
  const t = useTranslations("flight.suiteDashboard");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
          {t("coverage")}
        </span>
        <ProgressBar value={progress} showLabel />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DataValue label={t("images")} value="142" />
        <DataValue label={t("overlap")} value="78" unit="%" />
        <DataValue label={t("gsd")} value="2.1" unit="cm/px" />
        <DataValue label={t("area")} value="0.8" unit="km\u00B2" />
      </div>
    </div>
  );
}

function SarDashboard({ progress }: { progress: number }) {
  const t = useTranslations("flight.suiteDashboard");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
          {t("gridProgress")}
        </span>
        <ProgressBar value={progress} showLabel />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DataValue label={t("searchArea")} value="2.4" unit="km\u00B2" />
        <DataValue label={t("personsFound")} value="0" />
        <DataValue label={t("gridCells")} value={`${Math.round(progress / 10)}/10`} />
        <DataValue label={t("thermalHits")} value="3" />
      </div>
    </div>
  );
}

function GenericDashboard({ progress }: { progress: number }) {
  const t = useTranslations("flight.suiteDashboard");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
          {t("missionProgress")}
        </span>
        <ProgressBar value={progress} showLabel />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DataValue label={t("waypoints")} value={`${Math.round(progress / 10)}/10`} />
        <DataValue label={t("distance")} value="2.1" unit="km" />
      </div>
    </div>
  );
}

function getSuiteDashboard(
  suiteType: SuiteType | undefined,
  progress: number
) {
  switch (suiteType) {
    case "sentry":
      return <SentryDashboard progress={progress} />;
    case "survey":
      return <SurveyDashboard progress={progress} />;
    case "sar":
      return <SarDashboard progress={progress} />;
    default:
      return <GenericDashboard progress={progress} />;
  }
}

const SUITE_LABEL_KEYS: Partial<Record<SuiteType, string>> = {
  sentry: "sentry",
  survey: "survey",
  sar: "sar",
  agriculture: "agriculture",
  cargo: "cargo",
  inspection: "inspection",
};

export function SuiteDashboard() {
  const [collapsed, setCollapsed] = useState(false);
  const t = useTranslations("flight.suiteDashboard");
  const tSuite = useTranslations("flightInfo");
  const mission = useMissionStore((s) => s.activeMission);
  const progress = useMissionStore((s) => s.progress);

  if (!mission) return null;

  const suiteLabel = mission.suiteType
    ? (SUITE_LABEL_KEYS[mission.suiteType]
      ? tSuite(SUITE_LABEL_KEYS[mission.suiteType])
      : mission.suiteType)
    : t("mission");

  return (
    <div className="border-t border-border-default">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-tertiary transition-colors cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
          {t("dashboardTitle", { suite: suiteLabel })}
        </span>
        {collapsed ? (
          <ChevronDown size={12} className="text-text-tertiary" />
        ) : (
          <ChevronUp size={12} className="text-text-tertiary" />
        )}
      </button>

      {/* Content */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          collapsed ? "max-h-0" : "max-h-96"
        )}
      >
        <div className="px-3 pb-3">
          {/* Mission name */}
          <p className="text-xs text-text-secondary mb-2 truncate">
            {mission.name}
          </p>
          {getSuiteDashboard(mission.suiteType, progress || mission.progress)}
        </div>
      </div>
    </div>
  );
}
