/**
 * Bluetooth scan / pair / forget / list actions. Lifted out of
 * `peripherals-store.ts` to keep that slice file under the file-size
 * budget.
 *
 * @license GPL-3.0-only
 */

import { errorMessage } from "./error-handler";
import type { GroundStationState } from "./state";
import type { GroundStationApi } from "@/lib/api/ground-station-api";

type Setter = (
  partial:
    | Partial<GroundStationState>
    | ((s: GroundStationState) => Partial<GroundStationState>),
) => void;

type Getter = () => GroundStationState;

export async function scanBluetooth(
  api: GroundStationApi,
  durationS: number | undefined,
  set: Setter,
  get: Getter,
): Promise<void> {
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
}

export async function pairBluetooth(
  api: GroundStationApi,
  mac: string,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  set({ bluetooth: { ...get().bluetooth, pairing_mac: mac, error: null } });
  try {
    const res = await api.pairBluetooth(mac);
    set({ bluetooth: { ...get().bluetooth, pairing_mac: null, error: null } });
    if (res.paired) {
      try {
        const list = await api.getPairedBluetooth();
        const owner = get().bluetooth.pairedFor;
        if (owner === null || owner === api.baseUrl) {
          set({
            bluetooth: { ...get().bluetooth, paired: list.devices, pairedFor: api.baseUrl },
          });
        }
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
}

export async function forgetBluetooth(
  api: GroundStationApi,
  mac: string,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  try {
    const res = await api.forgetBluetooth(mac);
    if (res.forgotten && get().bluetooth.pairedFor === api.baseUrl) {
      const remaining = get().bluetooth.paired.filter((d) => d.mac !== mac);
      set({ bluetooth: { ...get().bluetooth, paired: remaining } });
    }
    return res.forgotten;
  } catch (err) {
    const { message } = errorMessage(err);
    set({ bluetooth: { ...get().bluetooth, error: message } });
    return false;
  }
}

export async function loadPairedBluetooth(
  api: GroundStationApi,
  set: Setter,
  get: Getter,
): Promise<void> {
  const target = api.baseUrl;
  // Switching node drops the previous node's list immediately.
  if (get().bluetooth.pairedFor !== target) {
    set({ bluetooth: { ...get().bluetooth, paired: [], pairedFor: target } });
  }
  try {
    const list = await api.getPairedBluetooth();
    if (get().bluetooth.pairedFor !== target) return;
    set({
      bluetooth: { ...get().bluetooth, paired: list.devices, error: null },
    });
  } catch (err) {
    const { message } = errorMessage(err);
    if (get().bluetooth.pairedFor !== target) return;
    set({ bluetooth: { ...get().bluetooth, error: message } });
  }
}
