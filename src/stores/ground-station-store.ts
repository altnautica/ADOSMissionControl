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
  EthernetConfig,
  EthernetConfigUpdate,
  Gamepad,
  GroundStationApi,
  ModemStatus,
  ModemUpdate,
  NetworkStatus,
  OledUpdate,
  PairResult,
  PicEvent,
  PicState,
  ScreensUpdate,
  UiConfig,
  UplinkEvent,
  UplinkFailoverEntry,
  UplinkHealth,
  WifiScanResult,
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

export interface WifiScanCache {
  results: WifiScanResult[];
  scanning: boolean;
  scannedAt: number | null;
  error: string | null;
}

export interface UplinkDataCap {
  state: "ok" | "warn_80" | "throttle_95" | "blocked_100";
  percent: number;
  used_mb: number;
  cap_mb: number;
}

export interface UplinkSlice {
  active: string | null;
  priority: string[];
  health: UplinkHealth;
  failover_log: UplinkFailoverEntry[];
  data_cap: UplinkDataCap | null;
  loading: boolean;
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

  // Phase 3 slices (Wave C) - network client, modem, uplink
  wifiScan: WifiScanCache;
  modem: ModemStatus | null;
  uplink: UplinkSlice;

  // Phase 4 (Wave 2) - Ethernet static-IP config (Wave 3 backend pending)
  ethernetConfig: EthernetConfig | null;

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

  // Phase 3 actions (Wave C)
  scanWifiNetworks: (
    api: GroundStationApi,
    timeoutS?: number,
  ) => Promise<WifiScanResult[]>;
  joinWifi: (
    api: GroundStationApi,
    ssid: string,
    passphrase?: string,
    force?: boolean,
  ) => Promise<{ joined: boolean; needsForce: boolean; error: string | null }>;
  leaveWifi: (api: GroundStationApi) => Promise<boolean>;
  loadModem: (api: GroundStationApi) => Promise<void>;
  applyModem: (
    api: GroundStationApi,
    update: ModemUpdate,
  ) => Promise<ModemStatus | null>;
  loadPriority: (api: GroundStationApi) => Promise<void>;
  applyPriority: (
    api: GroundStationApi,
    priority: string[],
  ) => Promise<string[] | null>;
  toggleShareUplink: (
    api: GroundStationApi,
    enabled: boolean,
  ) => Promise<boolean | null>;
  subscribeUplinkWs: (api: GroundStationApi) => () => void;

  // Phase 4 Wave 2 - Ethernet static-IP config
  loadEthernetConfig: (api: GroundStationApi) => Promise<EthernetConfig | null>;
  applyEthernetConfig: (
    api: GroundStationApi,
    update: EthernetConfigUpdate,
  ) => Promise<{ config: EthernetConfig | null; error: string | null; backendPending: boolean }>;

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

const INITIAL_WIFI_SCAN: WifiScanCache = {
  results: [],
  scanning: false,
  scannedAt: null,
  error: null,
};

const INITIAL_UPLINK: UplinkSlice = {
  active: null,
  priority: [],
  health: "ok",
  failover_log: [],
  data_cap: null,
  loading: false,
  error: null,
};

const FAILOVER_LOG_CAP = 20;

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

  wifiScan: INITIAL_WIFI_SCAN,
  modem: null,
  uplink: INITIAL_UPLINK,

  ethernetConfig: null,

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
          data_cap: modemFromNet?.data_cap ?? currentUplink.data_cap,
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

  // ============================================================
  // Phase 3 actions (Wave C) - network client, modem, uplink
  // ============================================================

  scanWifiNetworks: async (api, timeoutS) => {
    set({
      wifiScan: { ...get().wifiScan, scanning: true, error: null },
    });
    try {
      const res = await api.scanWifiClient(timeoutS ?? 10);
      const results = [...res.networks].sort((a, b) => b.signal - a.signal);
      set({
        wifiScan: {
          results,
          scanning: false,
          scannedAt: Date.now(),
          error: null,
        },
      });
      return results;
    } catch (err) {
      const { message } = errorMessage(err);
      set({
        wifiScan: { ...get().wifiScan, scanning: false, error: message },
      });
      return [];
    }
  },

  joinWifi: async (api, ssid, passphrase, force) => {
    try {
      const res = await api.joinWifiClient(ssid, passphrase, force);
      if (res.joined) {
        // refresh network on success
        try {
          const net = await api.getNetwork();
          const modemFromNet = net.modem_4g ?? net.modem ?? null;
          set({
            network: net,
            ap: net.ap,
            modem: modemFromNet,
          });
        } catch {
          // non-fatal
        }
      }
      return { joined: res.joined, needsForce: Boolean(res.needs_force), error: null };
    } catch (err) {
      const { message, status } = errorMessage(err);
      let needsForce = status === 409;
      if (err instanceof GroundStationApiError) {
        try {
          const parsed = JSON.parse(err.body) as { needs_force?: boolean; detail?: { needs_force?: boolean } };
          if (parsed.needs_force || parsed.detail?.needs_force) needsForce = true;
        } catch {
          // ignore parse failure
        }
      }
      return { joined: false, needsForce, error: message };
    }
  },

  leaveWifi: async (api) => {
    try {
      await api.leaveWifiClient();
      try {
        const net = await api.getNetwork();
        set({ network: net, ap: net.ap });
      } catch {
        // non-fatal
      }
      return true;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return false;
    }
  },

  loadModem: async (api) => {
    try {
      const m = await api.getModem();
      const currentUplink = get().uplink;
      set({
        modem: m,
        uplink: {
          ...currentUplink,
          data_cap: m.data_cap ?? currentUplink.data_cap,
        },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
    }
  },

  applyModem: async (api, update) => {
    try {
      const m = await api.setModem(update);
      const currentUplink = get().uplink;
      set({
        modem: m,
        uplink: {
          ...currentUplink,
          data_cap: m.data_cap ?? currentUplink.data_cap,
        },
      });
      return m;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return null;
    }
  },

  loadPriority: async (api) => {
    try {
      const res = await api.getPriority();
      const currentUplink = get().uplink;
      set({
        uplink: { ...currentUplink, priority: res.priority },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
    }
  },

  applyPriority: async (api, priority) => {
    const currentUplink = get().uplink;
    // optimistic update
    set({ uplink: { ...currentUplink, priority } });
    try {
      const res = await api.setPriority(priority);
      set({
        uplink: { ...get().uplink, priority: res.priority },
      });
      return res.priority;
    } catch (err) {
      const { message } = errorMessage(err);
      // revert on failure
      set({
        uplink: { ...get().uplink, priority: currentUplink.priority, error: message },
      });
      return null;
    }
  },

  toggleShareUplink: async (api, enabled) => {
    try {
      const res = await api.setShareUplink(enabled);
      const prev = get().network;
      if (prev) {
        set({ network: { ...prev, share_uplink: res.enabled } });
      }
      return res.enabled;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return null;
    }
  },

  subscribeUplinkWs: (api) => {
    return api.subscribeUplinkEvents((event: UplinkEvent) => {
      const current = get().uplink;
      if (event.type === "state") {
        const e = event as {
          active?: string | null;
          priority?: string[];
          health?: UplinkHealth;
        };
        set({
          uplink: {
            ...current,
            active: e.active ?? current.active,
            priority: e.priority ?? current.priority,
            health: e.health ?? current.health,
          },
        });
      } else if (event.type === "active") {
        const e = event as { iface: string };
        set({
          uplink: { ...current, active: e.iface },
        });
      } else if (event.type === "priority") {
        const e = event as { priority: string[] };
        set({
          uplink: { ...current, priority: e.priority },
        });
      } else if (event.type === "health") {
        const e = event as { health: UplinkHealth };
        set({
          uplink: { ...current, health: e.health },
        });
      } else if (event.type === "failover") {
        const e = event as {
          from: string | null;
          to: string;
          reason: string;
          timestamp?: number;
        };
        const entry: UplinkFailoverEntry = {
          from: e.from,
          to: e.to,
          reason: e.reason,
          timestamp: e.timestamp ?? Date.now(),
        };
        const nextLog = [entry, ...current.failover_log].slice(0, FAILOVER_LOG_CAP);
        set({
          uplink: {
            ...current,
            active: e.to,
            failover_log: nextLog,
          },
        });
      } else if (event.type === "data_cap") {
        const e = event as {
          state: "ok" | "warn_80" | "throttle_95" | "blocked_100";
          percent: number;
          used_mb: number;
          cap_mb: number;
        };
        set({
          uplink: {
            ...current,
            data_cap: {
              state: e.state,
              percent: e.percent,
              used_mb: e.used_mb,
              cap_mb: e.cap_mb,
            },
          },
        });
      }
    });
  },

  // ============================================================
  // Phase 4 Wave 2 - Ethernet static-IP config
  // Backend endpoint lands in Wave 3 (Violas). 404 surfaces as a
  // clear "backend pending" signal so the form does not look broken.
  // ============================================================

  loadEthernetConfig: async (api) => {
    try {
      const cfg = await api.getEthernetConfig();
      set({ ethernetConfig: cfg });
      return cfg;
    } catch (err) {
      const { message, status } = errorMessage(err);
      if (status === 404) {
        // Wave 3 backend not yet shipped. Do not pollute lastError.
        return null;
      }
      set({ lastError: message });
      return null;
    }
  },

  applyEthernetConfig: async (api, update) => {
    try {
      const cfg = await api.setEthernetConfig(update);
      const prev = get().ethernetConfig;
      const merged = prev ? { ...prev, ...cfg } : cfg;
      set({ ethernetConfig: merged });
      return { config: merged, error: null, backendPending: false };
    } catch (err) {
      const { message, status } = errorMessage(err);
      if (status === 404) {
        return {
          config: null,
          error: "Ethernet config backend pending (Phase 4 Wave 3)",
          backendPending: true,
        };
      }
      return { config: null, error: message, backendPending: false };
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
      wifiScan: INITIAL_WIFI_SCAN,
      modem: null,
      uplink: INITIAL_UPLINK,
      ethernetConfig: null,
    }),
}));
