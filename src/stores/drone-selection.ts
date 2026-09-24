/**
 * @module drone-selection
 * @description The drone manager's fleet and selection as the per-drone stores
 * (mission, geofence, rally, panel cache) and the telemetry bridge read them.
 * A leaf module: the drone manager binds itself here when it is created, and
 * those stores read it from here, so none of them imports the manager that
 * writes them on connect, switch and disconnect.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { DroneManagerState } from "./drone-manager";

export type DroneSelection = Pick<DroneManagerState, "drones" | "selectedDroneId">;

const NO_SELECTION: DroneSelection = { drones: new Map(), selectedDroneId: null };

let readSelection: (() => DroneSelection) | null = null;

/** Called once by the drone manager at creation. */
export function bindDroneSelection(read: () => DroneSelection): void {
  readSelection = read;
}

/** The fleet and selection now; empty before the drone manager exists. */
export function droneSelection(): DroneSelection {
  return readSelection ? readSelection() : NO_SELECTION;
}

/** The selected drone's protocol, or null when nothing is selected. */
export function selectedDroneProtocol(): DroneProtocol | null {
  const { drones, selectedDroneId } = droneSelection();
  return selectedDroneId ? drones.get(selectedDroneId)?.protocol ?? null : null;
}
