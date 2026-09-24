import { create } from "zustand";

/** What a Ctrl+S save actually did. `attempted` is the number of dirty
 *  parameters the save tried to write, so a keypress with nothing pending is
 *  reported as such instead of as a successful save. */
export interface PanelSaveOutcome {
  attempted: number;
  ok: boolean;
}

interface FcPanelActionsState {
  saveToRam: (() => Promise<PanelSaveOutcome>) | null;
  refresh: (() => Promise<void>) | null;
  register: (saveToRam: () => Promise<PanelSaveOutcome>, refresh: () => Promise<void>) => void;
  /** Clear the handlers, but only if `saveToRam` is still the registered one:
   *  a panel unmounting after another panel registered must not strip the
   *  newer panel's Ctrl+S / Ctrl+R. */
  unregister: (saveToRam: () => Promise<PanelSaveOutcome>) => void;
}

export const useFcPanelActionsStore = create<FcPanelActionsState>((set) => ({
  saveToRam: null,
  refresh: null,
  register: (saveToRam, refresh) => set({ saveToRam, refresh }),
  unregister: (saveToRam) =>
    set((s) => (s.saveToRam === saveToRam ? { saveToRam: null, refresh: null } : s)),
}));
