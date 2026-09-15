/**
 * @module PairingStore
 * @description Zustand store for ADOS agent pairing and discovery state.
 * Manages paired drones (persisted via Convex), discovered agents (mDNS/local),
 * and pairing flow state.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/**
 * A cloud-paired drone as mirrored from `cmdDrones.listMyDrones`.
 *
 * `apiKey` is the agent credential for that device. For a cloud-paired node
 * the Convex row is the only place the browser can get it — such a node was
 * never paired on this network, so `local-nodes-store` has no record — and
 * the post-pair connect, theme sync, config writes and the LAN-direct
 * fallback all resolve it from here. New code should prefer
 * `cmdDronesApi.getAgentKey` for a single device over reading the whole
 * mirrored fleet; the Convex read is owner-scoped either way.
 */
export interface PairedDrone {
  _id: string;
  userId: string;
  deviceId: string;
  name: string;
  apiKey: string;
  agentVersion?: string;
  board?: string;
  tier?: number;
  os?: string;
  mdnsHost?: string;
  lastIp?: string;
  lastSeen?: number;
  fcConnected?: boolean;
  pairedAt: number;
  /** Wire-contract node profile synced from the agent's heartbeat
   * onto cmd_drones. "drone" by default for legacy rows. */
  profile?: "drone" | "ground-station" | "workstation";
  /** Ground-station role when applicable; null on drones. */
  role?: "direct" | "relay" | "receiver" | null;
}

export interface DiscoveredAgent {
  deviceId: string;
  name: string;
  board: string;
  version: string;
  pairingCode: string;
  mdnsHost: string;
  localIp?: string;
}

interface PairingState {
  pairedDrones: PairedDrone[];
  discoveredAgents: DiscoveredAgent[];
  selectedPairedId: string | null;
  pairingInProgress: boolean;
  pairingError: string | null;

  setPairedDrones: (drones: PairedDrone[]) => void;
  setDiscoveredAgents: (agents: DiscoveredAgent[]) => void;
  selectPairedDrone: (droneId: string | null) => void;
  setPairingInProgress: (inProgress: boolean) => void;
  setPairingError: (error: string | null) => void;
  removePairedDrone: (droneId: string) => void;
  updatePairedDroneName: (droneId: string, name: string) => void;
  clear: () => void;
}

export const usePairingStore = create<PairingState>((set) => ({
  pairedDrones: [],
  discoveredAgents: [],
  selectedPairedId: null,
  pairingInProgress: false,
  pairingError: null,

  setPairedDrones: (drones) => set({ pairedDrones: drones }),
  setDiscoveredAgents: (agents) => set({ discoveredAgents: agents }),
  selectPairedDrone: (droneId) => set({ selectedPairedId: droneId }),
  setPairingInProgress: (inProgress) => set({ pairingInProgress: inProgress }),
  setPairingError: (error) => set({ pairingError: error }),
  removePairedDrone: (droneId) =>
    set((state) => ({
      pairedDrones: state.pairedDrones.filter((d) => d._id !== droneId),
      selectedPairedId:
        state.selectedPairedId === droneId ? null : state.selectedPairedId,
    })),
  updatePairedDroneName: (droneId, name) =>
    set((state) => ({
      pairedDrones: state.pairedDrones.map((d) =>
        d._id === droneId ? { ...d, name } : d
      ),
    })),
  clear: () =>
    set({
      pairedDrones: [],
      discoveredAgents: [],
      selectedPairedId: null,
      pairingInProgress: false,
      pairingError: null,
    }),
}));
