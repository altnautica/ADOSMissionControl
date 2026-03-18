import { create } from "zustand";
import type { FleetDrone, Alert } from "@/lib/types";

interface FleetStoreState {
  drones: FleetDrone[];
  alerts: Alert[];
  lastUpdate: number;

  setDrones: (drones: FleetDrone[]) => void;
  addDrone: (drone: FleetDrone) => void;
  removeDrone: (id: string) => void;
  updateDrone: (id: string, update: Partial<FleetDrone>) => void;
  addAlert: (alert: Alert) => void;
  acknowledgeAlert: (id: string) => void;
  clearAlerts: () => void;
  touch: () => void;
}

export const useFleetStore = create<FleetStoreState>((set) => ({
  drones: [],
  alerts: [],
  lastUpdate: 0,

  setDrones: (drones) => set({ drones, lastUpdate: Date.now() }),

  addDrone: (drone) =>
    set((state) => {
      // Idempotent: skip if already present
      if (state.drones.some((d) => d.id === drone.id)) return state;
      return { drones: [...state.drones, drone], lastUpdate: Date.now() };
    }),

  removeDrone: (id) =>
    set((state) => ({
      drones: state.drones.filter((d) => d.id !== id),
      lastUpdate: Date.now(),
    })),

  updateDrone: (id, update) =>
    set((state) => {
      const idx = state.drones.findIndex((d) => d.id === id);
      if (idx === -1) return state;
      const updated = [...state.drones];
      updated[idx] = { ...updated[idx], ...update };
      return { drones: updated, lastUpdate: Date.now() };
    }),

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

  touch: () => set({ lastUpdate: Date.now() }),
}));
