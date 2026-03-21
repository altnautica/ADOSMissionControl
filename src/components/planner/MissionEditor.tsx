/**
 * @module MissionEditor
 * @description Mission setup form in the right panel — mission name input,
 * drone assignment dropdown, and suite type selector.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { FleetDrone, SuiteType } from "@/lib/types";

interface MissionEditorProps {
  drones: FleetDrone[];
  missionName: string;
  selectedDroneId: string;
  suiteType: string;
  onNameChange: (name: string) => void;
  onDroneChange: (droneId: string) => void;
  onSuiteChange: (suite: string) => void;
}

export function MissionEditor({
  drones,
  missionName,
  selectedDroneId,
  suiteType,
  onNameChange,
  onDroneChange,
  onSuiteChange,
}: MissionEditorProps) {
  const t = useTranslations("planner");
  const availableDrones = drones.filter(
    (d) => d.status === "idle" || d.status === "online"
  );

  const SUITE_OPTIONS: { value: SuiteType | ""; label: string }[] = useMemo(() => [
    { value: "", label: t("none") },
    { value: "sentry", label: "Sentry" },
    { value: "survey", label: "Survey" },
    { value: "agriculture", label: "Agriculture" },
    { value: "cargo", label: "Cargo" },
    { value: "sar", label: "SAR" },
    { value: "inspection", label: "Inspection" },
  ], [t]);

  const droneOptions = [
    { value: "", label: t("selectDrone") },
    ...availableDrones.map((d) => ({
      value: d.id,
      label: `${d.name} (${Math.round(d.battery?.remaining ?? 0)}%)`,
    })),
  ];

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <Input
        label={t("missionName")}
        placeholder={t("missionNamePlaceholder")}
        value={missionName}
        onChange={(e) => onNameChange(e.target.value)}
      />
      <Select
        label={t("assignDrone")}
        options={droneOptions}
        value={selectedDroneId}
        onChange={onDroneChange}
      />
      <Select
        label={t("suite")}
        options={SUITE_OPTIONS}
        value={suiteType}
        onChange={onSuiteChange}
      />
    </div>
  );
}
