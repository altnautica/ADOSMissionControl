/**
 * @module AgentPeripheralsStore
 * @description Zustand store for ADOS Drone Agent peripheral device management.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { PeripheralInfo } from "@/lib/agent/types";
import { useAgentConnectionStore } from "./agent-connection-store";

interface AgentPeripheralsState {
  peripherals: PeripheralInfo[];
}

interface AgentPeripheralsActions {
  fetchPeripherals: () => Promise<void>;
  scanPeripherals: () => Promise<void>;
  clear: () => void;
}

export type AgentPeripheralsStore = AgentPeripheralsState & AgentPeripheralsActions;

export const useAgentPeripheralsStore = create<AgentPeripheralsStore>((set) => ({
  peripherals: [],

  async fetchPeripherals() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_peripherals");
      return;
    }
    if (!client) return;
    try {
      const peripherals = await client.getPeripherals();
      set({ peripherals });
    } catch { /* silent */ }
  },

  async scanPeripherals() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("scan_peripherals");
      return;
    }
    if (!client) return;
    try {
      const peripherals = await client.scanPeripherals();
      set({ peripherals });
    } catch { /* silent */ }
  },

  clear() {
    set({ peripherals: [] });
  },
}));
