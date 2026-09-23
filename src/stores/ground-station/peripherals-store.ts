/**
 * Peripherals slice for the ground-station store. Owns PIC arbiter state
 * (claim / release / heartbeat / WS), gamepads, bluetooth scan + pair,
 * OLED display config, and the Peripheral Manager listing for OLED, buttons,
 * joystick, gamepad, USB peripherals.
 *
 * @license GPL-3.0-only
 */

import type { GroundStationSliceCreator } from "./state";
import { errorMessage } from "./error-handler";
import {
  INITIAL_BLUETOOTH,
  INITIAL_GAMEPADS,
  INITIAL_PERIPHERALS,
  INITIAL_PIC,
} from "./initial-state";
import {
  forgetBluetooth,
  loadPairedBluetooth,
  pairBluetooth,
  scanBluetooth,
} from "./bluetooth-actions";
import {
  claimPic,
  loadPic,
  pollPicHeartbeat,
  releasePic,
  subscribePicWs,
} from "./pic-actions";
import type {
  BluetoothSlice as BluetoothSliceShape,
  GamepadsSlice as GamepadsSliceShape,
  PeripheralsSlice as PeripheralsSliceShape,
  PicSlice as PicSliceShape,
} from "./types";
import type {
  DisplayConfig,
  DisplayUpdate,
  GroundStationApi,
  PeripheralDetail,
} from "@/lib/api/ground-station-api";

export interface PeripheralsSlice {
  pic: PicSliceShape;
  gamepads: GamepadsSliceShape;
  bluetooth: BluetoothSliceShape;
  display: DisplayConfig | null;
  peripherals: PeripheralsSliceShape;

  loadPic: (api: GroundStationApi) => Promise<void>;
  claimPic: (
    api: GroundStationApi,
    clientId: string,
    opts?: { confirmToken?: string; force?: boolean },
  ) => Promise<boolean>;
  releasePic: (api: GroundStationApi, clientId: string) => Promise<boolean>;
  pollPicHeartbeat: (api: GroundStationApi, clientId: string) => () => void;
  subscribePicWs: (api: GroundStationApi) => () => void;
  loadGamepads: (api: GroundStationApi) => Promise<void>;
  applyPrimaryGamepad: (
    api: GroundStationApi,
    deviceId: string,
  ) => Promise<boolean>;
  scanBluetooth: (api: GroundStationApi, durationS?: number) => Promise<void>;
  pairBluetooth: (api: GroundStationApi, mac: string) => Promise<boolean>;
  forgetBluetooth: (api: GroundStationApi, mac: string) => Promise<boolean>;
  loadPairedBluetooth: (api: GroundStationApi) => Promise<void>;
  loadDisplay: (api: GroundStationApi) => Promise<void>;
  applyDisplay: (
    api: GroundStationApi,
    update: DisplayUpdate,
  ) => Promise<DisplayConfig | null>;
  loadPeripherals: (api: GroundStationApi) => Promise<void>;
  loadPeripheralDetail: (
    api: GroundStationApi,
    id: string,
  ) => Promise<PeripheralDetail | null>;
}

export const createPeripheralsSlice: GroundStationSliceCreator<PeripheralsSlice> = (
  set,
  get,
) => ({
  pic: INITIAL_PIC,
  gamepads: INITIAL_GAMEPADS,
  bluetooth: INITIAL_BLUETOOTH,
  display: null,
  peripherals: INITIAL_PERIPHERALS,

  loadPic: (api) => loadPic(api, set, get),
  claimPic: (api, clientId, opts) => claimPic(api, clientId, opts, set, get),
  releasePic: (api, clientId) => releasePic(api, clientId, set, get),
  pollPicHeartbeat: (api, clientId) => pollPicHeartbeat(api, clientId, set, get),
  subscribePicWs: (api) => subscribePicWs(api, set, get),

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
      await api.setPrimaryGamepad(deviceId);
    } catch (err) {
      const { message } = errorMessage(err);
      set({ lastError: message });
      return false;
    }
    // The write reply carries no device list; read it back.
    await get().loadGamepads(api);
    return true;
  },

  scanBluetooth: (api, durationS) => scanBluetooth(api, durationS, set, get),
  pairBluetooth: (api, mac) => pairBluetooth(api, mac, set, get),
  forgetBluetooth: (api, mac) => forgetBluetooth(api, mac, set, get),
  loadPairedBluetooth: (api) => loadPairedBluetooth(api, set, get),

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

  loadPeripherals: async (api) => {
    set({ peripherals: { ...get().peripherals, loading: true, error: null } });
    try {
      const res = await api.listPeripherals();
      set({
        peripherals: {
          ...get().peripherals,
          list: res.peripherals,
          loading: false,
          error: null,
        },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({
        peripherals: { ...get().peripherals, loading: false, error: message },
      });
    }
  },

  loadPeripheralDetail: async (api, id) => {
    try {
      const detail = await api.getPeripheral(id);
      const current = get().peripherals;
      set({
        peripherals: {
          ...current,
          detail: { ...current.detail, [id]: detail },
          error: null,
        },
      });
      return detail;
    } catch (err) {
      const { message } = errorMessage(err);
      set({
        peripherals: { ...get().peripherals, error: message },
      });
      return null;
    }
  },
});

