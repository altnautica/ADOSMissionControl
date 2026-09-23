/**
 * @module MissionEditor
 * @description Mission setup form in the right panel — mission name input
 * and drone assignment dropdown.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { FleetDrone } from "@/lib/types";
import { isFresh } from "@/lib/telemetry/freshness";
import { useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";

interface MissionEditorProps {
  drones: FleetDrone[];
  missionName: string;
  selectedDroneId: string;
  onNameChange: (name: string) => void;
  onDroneChange: (droneId: string) => void;
}

export function MissionEditor({
  drones,
  missionName,
  selectedDroneId,
  onNameChange,
  onDroneChange,
}: MissionEditorProps) {
  const t = useTranslations("planner");
  // Re-render on the shared 1 Hz clock so a battery reading ages into "stale".
  useClockTick();
  const now = useClockStore((s) => s.now);
  const availableDrones = drones.filter(
    (d) => d.status === "idle" || d.status === "online"
  );

  const droneOptions = [
    { value: "", label: t("selectDrone") },
    ...availableDrones.map((d) => ({
      value: d.id,
      label: `${d.name} (${batteryLabel(d, now, t("batteryStale"))})`,
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
    </div>
  );
}

/**
 * Battery figure for a drone row: "—" when there is no FC battery reading
 * (no FC linked, nothing received yet, or the FC reports the level unknown),
 * and the percentage marked stale once the reading stops updating.
 */
function batteryLabel(d: FleetDrone, now: number, staleLabel: string): string {
  const battery = d.fcAttached === false ? undefined : d.battery;
  if (!battery || !Number.isFinite(battery.remaining) || battery.remaining < 0) return "—";
  const pct = `${Math.round(battery.remaining)}%`;
  return isFresh(battery.timestamp, now) ? pct : `${pct}, ${staleLabel}`;
}
