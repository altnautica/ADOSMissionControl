/**
 * @module stores/aircraft-setup-offer-store
 * @description The flight-controller uids this device has already offered
 * aircraft setup for. The setup banner shows once per uid: following it or
 * putting it off records the uid here, persisted per device.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

/** localStorage key holding the offered FC uids. */
export const SETUP_OFFERED_KEY = "altcmd:aircraft-setup-offered";

interface AircraftSetupOfferState {
  /** FC uids (AUTOPILOT_VERSION uid) already offered on this device. */
  offered: string[];
  markOffered: (uid: string) => void;
}

type OfferedSlice = Pick<AircraftSetupOfferState, "offered">;

function local(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** JSON in localStorage. An earlier build stored the uids as a bare array
 * under the same key; it reads as the current shape, so those aircraft are
 * not offered setup again. */
const offeredStorage: PersistStorage<OfferedSlice> = {
  getItem: (name) => {
    const raw = local()?.getItem(name);
    if (raw == null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (Array.isArray(parsed)) {
      return { state: { offered: parsed.filter((u): u is string => typeof u === "string") }, version: 1 };
    }
    return parsed as StorageValue<OfferedSlice>;
  },
  setItem: (name, value) => local()?.setItem(name, JSON.stringify(value)),
  removeItem: (name) => local()?.removeItem(name),
};

export const useAircraftSetupOfferStore = create<AircraftSetupOfferState>()(
  persist(
    (set) => ({
      offered: [],
      markOffered: (uid) =>
        set((s) => (s.offered.includes(uid) ? s : { offered: [...s.offered, uid] })),
    }),
    {
      name: SETUP_OFFERED_KEY,
      version: 1,
      storage: offeredStorage,
      partialize: (s) => ({ offered: s.offered }),
    },
  ),
);
