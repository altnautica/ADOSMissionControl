/**
 * @module GroundStationStore
 * @description Zustand store for the ADOS Ground Agent / ground station state.
 * Phase 0: link health, WFB-ng config, and paired-drone status.
 * Phase 1 (Wave D): network, pair, UI slices plus API-driven actions.
 * Phase 2 (Wave C): pic, gamepads, bluetooth, display slices plus PIC WebSocket subscription.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  ApStatus,
  ApUpdate,
  BluetoothDevice,
  DisplayConfig,
  DisplayUpdate,
  Gamepad,
  GroundStationApi,
  NetworkStatus,
  OledUpdate,
  PairResult,
  PicEvent,
  PicState,
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

export interface PicSlice {
  state: string;
  claimed_by: string | null;
  claim_counter: number;
  primary_gamepad_id: string | null;
  loading: boolean;
  error: string | null;
}

export interface GamepadsSlice {
  devices: Gamepad[];
  primary_id: string | null;
  loading: boolean;
}

export interface BluetoothSlice {
  scanning: boolean;
  scan_results: BluetoothDevice[];
  paired: BluetoothDevice[];
  pairing_mac: string | null;
  error: string | null;
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

  // Phase 2 slices (Wave C)
  pic: PicSlice;
  gamepads: GamepadsSlice;
  bluetooth: BluetoothSlice;
  display: DisplayConfig | null;

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

  // Phase 2 actions (Wave C)
  loadPic: (api: GroundStationApi) => Promise<void>;
  claimPic: (
    api: GroundStationApi,
    clientId: string,
    opts?: { confirmToken?: string; force?: boolean },
  ) => Promise<boolean>;
  releasePic: (api: GroundStationApi, clientId: string) => Promise<boolean>;
  subscribePicWs: (api: GroundStationApi) => () => void;

  loadGamepads: (api: GroundStationApi) => Promise<void>;
  applyPrimaryGamepad: (api: GroundStationApi, deviceId: string | null) => Promise<boolean>;

  scanBluetooth: (api: GroundStationApi, durationS?: number) => Promise<void>;
  pairBluetooth: (api: GroundStationApi, mac: string) => Promise<boolean>;
  forgetBluetooth: (api: GroundStationApi, mac: string) => Promise<boolean>;
  loadPairedBluetooth: (api: GroundStationApi) => Promise<void>;

  loadDisplay: (api: GroundStationApi) => Promise<void>;
  applyDisplay: (api: GroundStationApi, update: DisplayUpdate) => Promise<DisplayConfig | null>;

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

const INITIAL_PIC: PicSlice = {
  state: "idle",
  claimed_by: null,
  claim_counter: 0,
  primary_gamepad_id: null,
  loading: false,
  error: null,
};

const INITIAL_GAMEPADS: GamepadsSlice = {
  devices: [],
  primary_id: null,
  loading: false,
};

const INITIAL_BLUETOOTH: BluetoothSlice = {
  scanning: false,
  scan_results: [],
  paired: [],
  pairing_mac: null,
  error: null,
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

  pic: INITIAL_PIC,
  gamepads: INITIAL_GAMEPADS,
  bluetooth: INITIAL_BLUETOOTH,
  display: null,

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

  // ============================================================
  // Phase 2 actions (Wave C)
  // ============================================================

  loadPic: async (api) => {
    set({ pic: { ...get().pic, loading: true, error: null } });
    try {
      const s = await api.getPicState();
      set({
        pic: {
          state: s.state,
          claimed_by: s.claimed_by,
          claim_counter: s.claim_counter,
          primary_gamepad_id: s.primary_gamepad_id,
          loading: false,
          error: null,
        },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ pic: { ...get().pic, loading: false, error: message } });
    }
  },

  claimPic: async (api, clientId, opts) => {
    set({ pic: { ...get().pic, loading: true, error: null } });
    try {
      const res = await api.claimPic(clientId, opts?.confirmToken, opts?.force);
      set({
        pic: {
          ...get().pic,
          loading: false,
          claimed_by: res.claimed_by,
          claim_counter: res.claim_counter,
          state: res.claimed ? "claimed" : get().pic.state,
          error: null,
        },
      });
      return res.claimed;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ pic: { ...get().pic, loading: false, error: message } });
      return false;
    }
  },

  releasePic: async (api, clientId) => {
    set({ pic: { ...get().pic, loading: true, error: null } });
    try {
      const res = await api.releasePic(clientId);
      set({
        pic: {
          ...get().pic,
          loading: false,
          claimed_by: res.claimed_by,
          state: res.released ? "idle" : get().pic.state,
          error: null,
        },
      });
      return res.released;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ pic: { ...get().pic, loading: false, error: message } });
      return false;
    }
  },

  subscribePicWs: (api) => {
    return api.subscribePicEvents((event: PicEvent) => {
      const current = get().pic;
      if (event.type === "state" || event.type === "claimed" || event.type === "released") {
        set({
          pic: {
            ...current,
            state: (event as { state?: string }).state ?? current.state,
            claimed_by:
              (event as { claimed_by?: string | null }).claimed_by !== undefined
                ? ((event as { claimed_by: string | null }).claimed_by)
                : current.claimed_by,
            claim_counter:
              (event as { claim_counter?: number }).claim_counter ?? current.claim_counter,
            primary_gamepad_id:
              (event as { primary_gamepad_id?: string | null }).primary_gamepad_id !== undefined
                ? ((event as { primary_gamepad_id: string | null }).primary_gamepad_id)
                : current.primary_gamepad_id,
          },
        });
      } else if (event.type === "gamepad_changed") {
        set({
          pic: {
            ...current,
            primary_gamepad_id:
              (event as { primary_gamepad_id?: string | null }).primary_gamepad_id ?? null,
          },
        });
      }
    });
  },

  loadGamepads: async (api) => {
    set({ gamepads: { ...get().gamepads, loading: true } });
    try {
      const list = await api.listGamepads();
      set({
        gamepads: {
          devices: list.devices,
          primary_id: list.primary_id,
          loading: false,
        },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({
        gamepads: { ...get().gamepads, loading: false },
        lastError: message,
      });
    }
  },

  applyPrimaryGamepad: async (api, deviceId) => {
    try {
      const list = await api.setPrimaryGamepad(deviceId);
      set({
        gamepads: {
          devices: list.devices,
          primary_id: list.primary_id,
          loading: false,
        },
      });
      return true;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return false;
    }
  },

  scanBluetooth: async (api, durationS) => {
    set({
      bluetooth: { ...get().bluetooth, scanning: true, error: null, scan_results: [] },
    });
    try {
      const res = await api.scanBluetooth(durationS ?? 10);
      set({
        bluetooth: {
          ...get().bluetooth,
          scanning: false,
          scan_results: res.devices,
          error: null,
        },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({
        bluetooth: { ...get().bluetooth, scanning: false, error: message },
      });
    }
  },

  pairBluetooth: async (api, mac) => {
    set({ bluetooth: { ...get().bluetooth, pairing_mac: mac, error: null } });
    try {
      const res = await api.pairBluetooth(mac);
      set({ bluetooth: { ...get().bluetooth, pairing_mac: null, error: null } });
      if (res.paired) {
        // refresh paired list
        try {
          const list = await api.getPairedBluetooth();
          set({ bluetooth: { ...get().bluetooth, paired: list.devices } });
        } catch {
          // non-fatal
        }
      }
      return res.paired;
    } catch (err) {
      const { message } = errorMessage(err);
      set({
        bluetooth: { ...get().bluetooth, pairing_mac: null, error: message },
      });
      return false;
    }
  },

  forgetBluetooth: async (api, mac) => {
    try {
      const res = await api.forgetBluetooth(mac);
      if (res.forgotten) {
        const remaining = get().bluetooth.paired.filter((d) => d.mac !== mac);
        set({ bluetooth: { ...get().bluetooth, paired: remaining } });
      }
      return res.forgotten;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ bluetooth: { ...get().bluetooth, error: message } });
      return false;
    }
  },

  loadPairedBluetooth: async (api) => {
    try {
      const list = await api.getPairedBluetooth();
      set({
        bluetooth: { ...get().bluetooth, paired: list.devices, error: null },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ bluetooth: { ...get().bluetooth, error: message } });
    }
  },

  loadDisplay: async (api) => {
    try {
      const d = await api.getDisplay();
      set({ display: d });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
    }
  },

  applyDisplay: async (api, update) => {
    try {
      const d = await api.setDisplay(update);
      set({ display: d });
      return d;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return null;
    }
  },

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
      pic: INITIAL_PIC,
      gamepads: INITIAL_GAMEPADS,
      bluetooth: INITIAL_BLUETOOTH,
      display: null,
    }),
}));
