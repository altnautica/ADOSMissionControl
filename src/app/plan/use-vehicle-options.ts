/**
 * @module use-vehicle-options
 * @description Options for the planner's vehicle assignment select: every
 * flight vehicle in the fleet that is not offline, labelled with its battery
 * reading. Nodes without a flight controller (ground stations, displays, an
 * agent with no FC behind it) cannot fly a mission, so they are not offered.
 * The plan's current vehicle always stays listed, so the select never goes
 * blank when the plan names a drone that is busy, offline or out of the fleet.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import type { FleetDrone, SelectOption } from "@/lib/types";
import { isFresh } from "@/lib/telemetry/freshness";
import { knownRemainingPct } from "@/lib/battery";
import { useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";

export function useVehicleOptions(drones: FleetDrone[], selectedDroneId = ""): SelectOption[] {
  const t = useTranslations("planner");
  // Re-render on the shared 1 Hz clock so a battery reading ages into "stale".
  useClockTick();
  const now = useClockStore((s) => s.now);
  const vehicles = drones.filter(
    (d) => d.fcAttached !== false && (d.status !== "offline" || d.id === selectedDroneId),
  );
  const options: SelectOption[] = [
    { value: "", label: t("selectDrone") },
    ...vehicles.map((d) => ({
      value: d.id,
      label: `${d.name} (${batteryLabel(d, now, t("batteryStale"))})`,
    })),
  ];
  if (selectedDroneId && !vehicles.some((d) => d.id === selectedDroneId)) {
    const known = drones.find((d) => d.id === selectedDroneId);
    options.push({ value: selectedDroneId, label: known?.name ?? selectedDroneId });
  }
  return options;
}

/**
 * Battery figure for a vehicle row: "—" when there is no battery reading
 * (nothing received yet, or the FC reports the level unknown), and the
 * percentage marked stale once the reading stops updating.
 */
function batteryLabel(d: FleetDrone, now: number, staleLabel: string): string {
  const remaining = knownRemainingPct(d.battery?.remaining);
  if (!d.battery || remaining === null) return "—";
  const pct = `${Math.round(remaining)}%`;
  return isFresh(d.battery.timestamp, now) ? pct : `${pct}, ${staleLabel}`;
}
