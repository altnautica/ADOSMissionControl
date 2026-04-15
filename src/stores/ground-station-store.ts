/**
 * @module GroundStationStore
 * @description Zustand store for the ADOS Ground Agent / ground station state.
 * Phase 0: link health, WFB-ng config, and paired-drone status.
 * Phase 1 (Wave D): network, pair, UI slices plus API-driven actions.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  ApStatus,
  ApUpdate,
  GroundStationApi,
  NetworkStatus,
  OledUpdate,
  PairResult,
  ScreensUpdate,
  UiConfig,
} from "@/lib/api/ground-station-api";
import { GroundStationApiError } from "@/lib/api/ground-station-api";

export interface GroundStationLinkHealth {
  rssi_dbm: number | null;
  bitrate_mbps: number | null;
  fec_rec: number;
  fec_lost: number;
  channel: number | null;
}

export type WfbBitrateProfile = "low-latency" | "balanced" | "long-range";

export interface WfbConfig {
  channel: number;
  bitrate_profile: WfbBitrateProfile;
}

export type GroundStationProfile =
  | "ground_station"
  | "drone"
  | "auto"
  | "unconfigured";

export interface GroundStationStatus {
  paired_drone: string | null;
  profile: GroundStationProfile;
  uplink_active: string | null;
}

export interface PairSlice {
  loading: boolean;
  result: PairResult | null;
  error: string | null;
  errorStatus: number | null;
}

interface GroundStationState {
  linkHealth: GroundStationLinkHealth;
  wfbConfig: WfbConfig | null;
  status: GroundStationStatus;
  loading: boolean;
  lastError: string | null;
  lastFetchedAt: number | null;

  // Phase 1 slices
  network: NetworkStatus | null;
  ap: ApStatus | null;
  pair: PairSlice;
  ui: UiConfig | null;

  // Existing actions
  loadStatus: (status: GroundStationStatus, linkHealth?: Partial<GroundStationLinkHealth>) => void;
  loadWfb: (wfb: WfbConfig) => void;
  setWfbConfig: (partial: Partial<WfbConfig>) => void;
  setLoading: (loading: boolean) => void;
  setError: (message: string | null) => void;
  reset: () => void;

  // Phase 1 actions
  loadNetwork: (api: GroundStationApi) => Promise<void>;
  applyAp: (api: GroundStationApi, update: ApUpdate) => Promise<ApStatus | null>;
  loadUi: (api: GroundStationApi) => Promise<void>;
  applyOled: (api: GroundStationApi, update: OledUpdate) => Promise<UiConfig | null>;
  applyScreens: (api: GroundStationApi, update: ScreensUpdate) => Promise<UiConfig | null>;
  startPair: (api: GroundStationApi, pairKey: string, droneId?: string) => Promise<void>;
  unpair: (api: GroundStationApi) => Promise<void>;
  clearPair: () => void;
  resetAll: () => void;
}

const INITIAL_LINK_HEALTH: GroundStationLinkHealth = {
  rssi_dbm: null,
  bitrate_mbps: null,
  fec_rec: 0,
  fec_lost: 0,
  channel: null,
};

const INITIAL_STATUS: GroundStationStatus = {
  paired_drone: null,
  profile: "unconfigured",
  uplink_active: null,
};

const INITIAL_PAIR: PairSlice = {
  loading: false,
  result: null,
  error: null,
  errorStatus: null,
};

function errorMessage(err: unknown): { message: string; status: number | null } {
  if (err instanceof GroundStationApiError) {
    let parsedMsg = err.body;
    try {
      const parsed = JSON.parse(err.body) as { detail?: string; message?: string };
      parsedMsg = parsed.detail || parsed.message || err.body;
    } catch {
      // keep raw body
    }
    return { message: parsedMsg || err.message, status: err.status };
  }
  if (err instanceof Error) return { message: err.message, status: null };
  return { message: "Unknown error", status: null };
}

export const useGroundStationStore = create<GroundStationState>((set, get) => ({
  linkHealth: INITIAL_LINK_HEALTH,
  wfbConfig: null,
  status: INITIAL_STATUS,
  loading: false,
  lastError: null,
  lastFetchedAt: null,

  network: null,
  ap: null,
  pair: INITIAL_PAIR,
  ui: null,

  loadStatus: (status, linkHealth) => {
    const current = get().linkHealth;
    set({
      status,
      linkHealth: linkHealth ? { ...current, ...linkHealth } : current,
      lastFetchedAt: Date.now(),
      lastError: null,
    });
  },

  loadWfb: (wfb) => {
    set({ wfbConfig: wfb, lastFetchedAt: Date.now(), lastError: null });
  },

  setWfbConfig: (partial) => {
    const current = get().wfbConfig;
    if (!current) return;
    set({ wfbConfig: { ...current, ...partial } });
  },

  setLoading: (loading) => set({ loading }),

  setError: (message) => set({ lastError: message }),

  reset: () =>
    set({
      linkHealth: INITIAL_LINK_HEALTH,
      wfbConfig: null,
      status: INITIAL_STATUS,
      loading: false,
      lastError: null,
      lastFetchedAt: null,
    }),

  loadNetwork: async (api) => {
    try {
      const net = await api.getNetwork();
      set({ network: net, ap: net.ap, lastError: null });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
    }
  },

  applyAp: async (api, update) => {
    try {
      const ap = await api.setAp(update);
      const prev = get().network;
      set({
        ap,
        network: prev ? { ...prev, ap } : prev,
        lastError: null,
      });
      return ap;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return null;
    }
  },

  loadUi: async (api) => {
    try {
      const ui = await api.getUi();
      set({ ui, lastError: null });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
    }
  },

  applyOled: async (api, update) => {
    try {
      const ui = await api.setOled(update);
      set({ ui, lastError: null });
      return ui;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return null;
    }
  },

  applyScreens: async (api, update) => {
    try {
      const ui = await api.setScreens(update);
      set({ ui, lastError: null });
      return ui;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return null;
    }
  },

  startPair: async (api, pairKey, droneId) => {
    set({ pair: { loading: true, result: null, error: null, errorStatus: null } });
    try {
      const result = await api.pairDrone(pairKey, droneId);
      set({
        pair: { loading: false, result, error: null, errorStatus: null },
        status: { ...get().status, paired_drone: result.paired_drone_id },
      });
    } catch (err) {
      const { message, status } = errorMessage(err);
      set({
        pair: { loading: false, result: null, error: message, errorStatus: status },
      });
    }
  },

  unpair: async (api) => {
    try {
      await api.unpairDrone();
      set({
        pair: INITIAL_PAIR,
        status: { ...get().status, paired_drone: null },
      });
    } catch (err) {
      const { message, status } = errorMessage(err);
      set({
        pair: { ...get().pair, error: message, errorStatus: status, loading: false },
      });
    }
  },

  clearPair: () => set({ pair: INITIAL_PAIR }),

  resetAll: () =>
    set({
      linkHealth: INITIAL_LINK_HEALTH,
      wfbConfig: null,
      status: INITIAL_STATUS,
      loading: false,
      lastError: null,
      lastFetchedAt: null,
      network: null,
      ap: null,
      pair: INITIAL_PAIR,
      ui: null,
    }),
}));
