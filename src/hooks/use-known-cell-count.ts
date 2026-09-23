"use client";

/**
 * @module use-known-cell-count
 * @description Series cell count known independently of the live pack
 * voltage: the count the FC reports for the pack, else the `cells` of the
 * battery pack fitted to the drone in its loadout. `null` when neither
 * establishes it. Feed the result to `resolveCellCount`, which prefers
 * measured per-cell voltages over it.
 *
 * @license GPL-3.0-only
 */

import { useLoadoutStore } from "@/stores/loadout-store";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";

export function useKnownCellCount(
  droneId: string | null,
  reportedCellCount: number | undefined,
): number | null {
  const batteryIds = useLoadoutStore((s) =>
    droneId ? s.loadouts[droneId]?.batteryIds : undefined,
  );
  const loadoutCells = useBatteryRegistryStore((s) => {
    for (const id of batteryIds ?? []) {
      const cells = s.packs[id]?.cells;
      if (typeof cells === "number" && cells > 0) return cells;
    }
    return null;
  });

  if (typeof reportedCellCount === "number" && reportedCellCount > 0) {
    return reportedCellCount;
  }
  return loadoutCells;
}
