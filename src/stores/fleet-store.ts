import { create } from "zustand";
import type { Alert } from "@/lib/types";

/**
 * Fleet alerts. The fleet itself is derived from the node registry on read
 * (`useFleetDrones` / `getFleetDrones` in `node-registry/use-fleet-drones`).
 */
interface FleetStoreState {
  alerts: Alert[];

  addAlert: (alert: Alert) => void;
  acknowledgeAlert: (id: string) => void;
  clearAlerts: () => void;
}

export const useFleetStore = create<FleetStoreState>((set) => ({
  alerts: [],

  addAlert: (alert) =>
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 100), // keep last 100
    })),

  acknowledgeAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.map((a) =>
        a.id === id ? { ...a, acknowledged: true } : a
      ),
    })),

  clearAlerts: () => set({ alerts: [] }),
}));
