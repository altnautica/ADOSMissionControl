/**
 * @module FleetNetworkStore
 * @description Zustand store for ADOS Drone Agent fleet network state
 * (mesh peers).
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { NetworkPeer } from "@/lib/agent/types";
import { useAgentConnectionStore } from "./agent-connection-store";

interface FleetNetworkState {
  peers: NetworkPeer[];
}

interface FleetNetworkActions {
  fetchPeers: () => Promise<void>;
  clear: () => void;
}

export type FleetNetworkStore = FleetNetworkState & FleetNetworkActions;

export const useFleetNetworkStore = create<FleetNetworkStore>((set) => ({
  peers: [],

  async fetchPeers() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_peers");
      return;
    }
    if (!client) return;
    try {
      const peers = await client.getPeers();
      set({ peers });
    } catch { /* silent */ }
  },

  clear() {
    set({ peers: [] });
  },
}));
