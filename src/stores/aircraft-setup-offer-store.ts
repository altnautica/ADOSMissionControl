/**
 * @module stores/aircraft-setup-offer-store
 * @description The flight-controller uids this device has already offered
 * aircraft setup for. The setup banner shows once per uid: following it or
 * putting it off records the uid here, persisted per device.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** localStorage key holding the offered FC uids. */
export const SETUP_OFFERED_KEY = "altcmd:aircraft-setup-offered";

interface AircraftSetupOfferState {
  /** FC uids (AUTOPILOT_VERSION uid) already offered on this device. */
  offered: string[];
  markOffered: (uid: string) => void;
}

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
      partialize: (s) => ({ offered: s.offered }),
    },
  ),
);
