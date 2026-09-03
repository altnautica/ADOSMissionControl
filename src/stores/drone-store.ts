import { create } from "zustand";
import type { ConnectionState, FlightMode, ArmState } from "@/lib/types";
import type { FirmwareType } from "@/lib/protocol/types";

interface DroneStoreState {
  selectedId: string | null;
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

  selectDrone: (id: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setFlightMode: (mode: FlightMode) => void;
  setArmState: (state: ArmState) => void;
  heartbeat: () => void;
  setFirmwareInfo: (version: string, frame: string) => void;
  setSystemStatus: (status: number) => void;
  setFirmwareType: (type: FirmwareType | null) => void;
}

export const useDroneStore = create<DroneStoreState>((set) => ({
  selectedId: null,
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

  selectDrone: (id) => set({ selectedId: id }),
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
