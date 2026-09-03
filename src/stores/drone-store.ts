/**
 * @module drone-store
 * @description Live flight state of the SELECTED vehicle: connection, mode,
 * arm state, heartbeat, firmware. Single-slot by design — the drone manager
 * clears it on a selection switch so a newly selected drone never shows the
 * previous one's readings.
 *
 * Selection itself lives in `drone-manager.selectedDroneId` and nowhere else.
 * This store used to carry a `selectedId` mirror that the manager kept in
 * sync, but the sync was not reliable: `selectDrone(null)` skipped the
 * propagation entirely and `clear()` never propagated, so the mirror could
 * name a drone the manager had already deselected. The telemetry write gate in
 * `drone-manager-bridge` read the mirror, so it could pass for the wrong drone
 * and interleave a background vehicle's frames into the shared telemetry
 * rings. Read `useDroneManager((s) => s.selectedDroneId)` instead.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { ConnectionState, FlightMode, ArmState } from "@/lib/types";
import type { FirmwareType } from "@/lib/protocol/types";

interface DroneStoreState {
  connectionState: ConnectionState;
  flightMode: FlightMode;
  previousMode: FlightMode;
  armState: ArmState;
  /**
   * When the vehicle last transitioned into `armed`, or null while disarmed.
   *
   * Flight time has to be measured from here rather than from a component
   * effect: the cockpit clock used to start at `Date.now()` inside its own
   * `useEffect`, so it restarted at 0:00 on every remount — switching to the
   * map and back reset the flight timer mid-flight. It is a property of the
   * vehicle's arm state, not of whichever component happens to be mounted.
   */
  armedAt: number | null;
  lastHeartbeat: number;
  firmwareVersion: string;
  frameType: string;
  systemStatus: number;
  firmwareType: FirmwareType | null;

  setConnectionState: (state: ConnectionState) => void;
  setFlightMode: (mode: FlightMode) => void;
  setArmState: (state: ArmState) => void;
  heartbeat: () => void;
  setFirmwareInfo: (version: string, frame: string) => void;
  setSystemStatus: (status: number) => void;
  setFirmwareType: (type: FirmwareType | null) => void;
}

export const useDroneStore = create<DroneStoreState>((set) => ({
  connectionState: "disconnected",
  flightMode: "STABILIZE",
  previousMode: "STABILIZE",
  armState: "disarmed",
  armedAt: null,
  lastHeartbeat: 0,
  firmwareVersion: "",
  frameType: "",
  systemStatus: 0,
  firmwareType: null,

  setConnectionState: (connectionState) => set({ connectionState }),
  setFlightMode: (flightMode) => set((s) => ({ previousMode: s.flightMode, flightMode })),
  setArmState: (armState) =>
    set((s) => {
      if (armState === s.armState) return { armState };
      // Stamped on the transition into armed, and cleared on the way out, so a
      // re-arm starts a fresh clock instead of continuing the previous one.
      return { armState, armedAt: armState === "armed" ? Date.now() : null };
    }),
  heartbeat: () => set({ lastHeartbeat: Date.now() }),
  setFirmwareInfo: (firmwareVersion, frameType) => set({ firmwareVersion, frameType }),
  setSystemStatus: (systemStatus) => set({ systemStatus }),
  setFirmwareType: (firmwareType) => set({ firmwareType }),
}));
