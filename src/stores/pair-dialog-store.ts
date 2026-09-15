/**
 * @module pair-dialog-store
 * @description Global open/close state for the Pair-a-Node dialog, mirroring
 * connect-dialog-store. Lifting this out of CommandPage's local state lets the
 * dashboard zero-state and the locked agent tabs open pairing from anywhere
 * without prop-drilling. CommandPage still owns the PairingDialog mount and the
 * `/pair?code=` deep-link continues to drive the initial code independently.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** Which tab the pairing dialog should open on. */
export type PairDialogTab = "add" | "generate";

interface PairDialogState {
  open: boolean;
  /** Preferred tab when the dialog opens. Consumers may ignore it. */
  initialTab: PairDialogTab;
  /** A host to pre-load into the Add-a-Node field, or null. Set when the
   * operator picks an agent the GCS already found on the network, so the
   * discovery list is a genuinely zero-typing path instead of a display that
   * makes them retype what it just showed them. Consumed once: the form clears
   * it as it reads it, so reopening the dialog does not re-probe. */
  prefillHost: string | null;
  openDialog: (initialTab?: PairDialogTab, prefillHost?: string) => void;
  /** Clear the pre-loaded host after the form has taken it. */
  consumePrefillHost: () => void;
  closeDialog: () => void;
}

export const usePairDialogStore = create<PairDialogState>((set) => ({
  open: false,
  initialTab: "add",
  prefillHost: null,
  openDialog: (initialTab: PairDialogTab = "add", prefillHost?: string) =>
    set({ open: true, initialTab, prefillHost: prefillHost ?? null }),
  consumePrefillHost: () => set({ prefillHost: null }),
  closeDialog: () => set({ open: false, prefillHost: null }),
}));
