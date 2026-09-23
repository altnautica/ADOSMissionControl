/**
 * Pair slice for the ground-station store. Owns the pairing flow (BIP-39
 * pair-key entry, drone-id capture, paired-drone status), the network
 * snapshot the pair flow leans on, AP config, and the OLED + screens UI
 * config tied to the paired status.
 *
 * @license GPL-3.0-only
 */

import type { GroundStationSliceCreator } from "./state";
import { errorMessage } from "./error-handler";
import { INITIAL_PAIR } from "./initial-state";
import { dataCapFromModem } from "./uplink-ws";
import type { PairSlice as PairSliceShape } from "./types";
import type {
  ApStatus,
  ApUpdate,
  GroundStationApi,
  NetworkStatus,
  OledUpdate,
  ScreensUpdate,
  UiConfig,
} from "@/lib/api/ground-station-api";

export interface PairSlice {
  network: NetworkStatus | null;
  ap: ApStatus | null;
  pair: PairSliceShape;
  ui: UiConfig | null;

  loadNetwork: (api: GroundStationApi) => Promise<void>;
  applyAp: (api: GroundStationApi, update: ApUpdate) => Promise<ApStatus | null>;
  loadUi: (api: GroundStationApi) => Promise<void>;
  applyOled: (
    api: GroundStationApi,
    update: OledUpdate,
  ) => Promise<UiConfig | null>;
  applyScreens: (
    api: GroundStationApi,
    update: ScreensUpdate,
  ) => Promise<UiConfig | null>;
  startPair: (
    api: GroundStationApi,
    pairKey: string,
    droneId?: string,
  ) => Promise<void>;
  unpair: (api: GroundStationApi) => Promise<void>;
  clearPair: () => void;
}

export const createPairSlice: GroundStationSliceCreator<PairSlice> = (
  set,
  get,
) => ({
  network: null,
  ap: null,
  pair: INITIAL_PAIR,
  ui: null,

  loadNetwork: async (api) => {
    try {
      const net = await api.getNetwork();
      const modemFromNet = net.modem_4g ?? net.modem ?? null;
      const currentUplink = get().uplink;
      set({
        network: net,
        ap: net.ap,
        modem: modemFromNet,
        uplink: {
          ...currentUplink,
          active: net.active_uplink ?? currentUplink.active,
          priority: net.priority ?? currentUplink.priority,
          data_cap: dataCapFromModem(modemFromNet) ?? currentUplink.data_cap,
          fetchedAt: Date.now(),
        },
        lastError: null,
      });
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
        pair: {
          loading: false,
          result: null,
          error: message,
          errorStatus: status,
        },
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
        pair: {
          ...get().pair,
          error: message,
          errorStatus: status,
          loading: false,
        },
      });
    }
  },

  clearPair: () => set({ pair: INITIAL_PAIR }),
});

