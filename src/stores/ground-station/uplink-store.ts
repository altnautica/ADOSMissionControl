/**
 * Uplink slice for the ground-station store. Owns the WiFi-client / Ethernet
 * / 4G modem uplink matrix, priority order, data-cap throttle ladder, share-
 * uplink toggle, ethernet static-IP config, and the uplink WebSocket bridge
 * that streams active / health / failover / data-cap events.
 *
 * @license GPL-3.0-only
 */

import type { GroundStationSliceCreator } from "./state";
import { errorMessage } from "./error-handler";
import { INITIAL_UPLINK, INITIAL_WIFI_SCAN } from "./initial-state";
import { dataCapFromModem, subscribeUplinkWs } from "./uplink-ws";
import type { UplinkSlice as UplinkSliceShape, WifiScanCache } from "./types";
import type {
  EthernetConfig,
  EthernetConfigUpdate,
  GroundStationApi,
  ModemView,
  ModemUpdate,
  WifiScanResult,
} from "@/lib/api/ground-station-api";
import { GroundStationApiError } from "@/lib/api/ground-station-api";

export interface UplinkSlice {
  wifiScan: WifiScanCache;
  modem: ModemView | null;
  uplink: UplinkSliceShape;
  ethernetConfig: EthernetConfig | null;
  /** Agent origin that `modem`, `uplink.priority` and `ethernetConfig` belong
   * to. A read for any other origin is dropped, so a late response from the
   * previously shown node never lands on the current one. */
  uplinkFor: string | null;

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
  ) => Promise<ModemView | null>;
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
  loadEthernetConfig: (
    api: GroundStationApi,
  ) => Promise<EthernetConfig | null>;
  applyEthernetConfig: (
    api: GroundStationApi,
    update: EthernetConfigUpdate,
  ) => Promise<{
    config: EthernetConfig | null;
    error: string | null;
    backendPending: boolean;
  }>;
}

export const createUplinkSlice: GroundStationSliceCreator<UplinkSlice> = (
  set,
  get,
) => {
  /** Point the load-once uplink slices at `target`; switching node drops the
   * previous node's modem, priority and ethernet values immediately. */
  const claimTarget = (target: string) => {
    if (get().uplinkFor === target) return;
    set({
      uplinkFor: target,
      modem: null,
      ethernetConfig: null,
      uplink: { ...get().uplink, priority: INITIAL_UPLINK.priority },
    });
  };
  const owns = (api: GroundStationApi) => get().uplinkFor === api.baseUrl;

  return {
    wifiScan: INITIAL_WIFI_SCAN,
    modem: null,
    uplink: INITIAL_UPLINK,
    ethernetConfig: null,
    uplinkFor: null,

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
            const parsed = JSON.parse(err.body) as {
              needs_force?: boolean;
              detail?: { needs_force?: boolean };
            };
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
      claimTarget(api.baseUrl);
      try {
        const m = await api.getModem();
        if (!owns(api)) return;
        const currentUplink = get().uplink;
        set({
          modem: m,
          uplink: {
            ...currentUplink,
            data_cap: dataCapFromModem(m) ?? currentUplink.data_cap,
          },
        });
      } catch (err) {
        const { message } = errorMessage(err);
        if (owns(api)) set({ lastError: message });
      }
    },

    applyModem: async (api, update) => {
      try {
        const m = await api.setModem(update);
        if (!owns(api)) return m;
        const currentUplink = get().uplink;
        set({
          modem: m,
          uplink: {
            ...currentUplink,
            data_cap: dataCapFromModem(m) ?? currentUplink.data_cap,
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
      claimTarget(api.baseUrl);
      try {
        const res = await api.getPriority();
        if (!owns(api)) return;
        const currentUplink = get().uplink;
        set({
          uplink: { ...currentUplink, priority: res.priority },
        });
      } catch (err) {
        const { message } = errorMessage(err);
        if (owns(api)) set({ lastError: message });
      }
    },

    applyPriority: async (api, priority) => {
      const prevUplink = get().uplink;
      set({ uplink: { ...prevUplink, priority } });
      try {
        const res = await api.setPriority(priority);
        set({
          uplink: { ...get().uplink, priority: res.priority },
        });
        return res.priority;
      } catch (err) {
        const { message } = errorMessage(err);
        set({
          uplink: { ...prevUplink, error: message },
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
        // Surface whether the firewall/NAT rule actually applied. Older agents
        // omit `applied`; treat that as a success so the warning never shows.
        const applied = res.applied ?? true;
        set({
          uplink: {
            ...get().uplink,
            shareUplinkApplied: applied,
            shareUplinkAppliedReason: applied ? null : res.apply_error ?? null,
          },
        });
        return res.enabled;
      } catch (err) {
        const { message } = errorMessage(err);
        set({ lastError: message });
        return null;
      }
    },

    subscribeUplinkWs: (api) => subscribeUplinkWs(api, set, get),

    loadEthernetConfig: async (api) => {
      claimTarget(api.baseUrl);
      try {
        const cfg = await api.getEthernetConfig();
        if (!owns(api)) return null;
        set({ ethernetConfig: cfg });
        return cfg;
      } catch (err) {
        const { message, status } = errorMessage(err);
        if (status === 404) {
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
        if (owns(api)) set({ ethernetConfig: merged });
        return { config: merged, error: null, backendPending: false };
      } catch (err) {
        const { message, status } = errorMessage(err);
        if (status === 404) {
          return {
            config: null,
            error: "Ethernet config backend pending",
            backendPending: true,
          };
        }
        return { config: null, error: message, backendPending: false };
      }
    },
  };
};

