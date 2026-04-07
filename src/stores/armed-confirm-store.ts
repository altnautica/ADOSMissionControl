import { create } from "zustand";

export interface ArmedConfirmContext {
  panelId: string;
  paramNames: string[];
}

interface ArmedConfirmState {
  open: boolean;
  context: ArmedConfirmContext | null;
  _resolve: ((confirmed: boolean) => void) | null;
  /**
   * Request a confirmation dialog for a write while the vehicle is armed.
   * Resolves true if the user clicks "Write Anyway", false if cancelled
   * or dismissed.
   */
  requestConfirm: (context: ArmedConfirmContext) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
}

export const useArmedConfirmStore = create<ArmedConfirmState>((set, get) => ({
  open: false,
  context: null,
  _resolve: null,

  requestConfirm: (context) => {
    // If a prior dialog is somehow still open, resolve it as cancelled.
    const prior = get()._resolve;
    if (prior) prior(false);

    return new Promise<boolean>((resolve) => {
      set({ open: true, context, _resolve: resolve });
    });
  },

  confirm: () => {
    const resolve = get()._resolve;
    if (resolve) resolve(true);
    set({ open: false, context: null, _resolve: null });
  },

  cancel: () => {
    const resolve = get()._resolve;
    if (resolve) resolve(false);
    set({ open: false, context: null, _resolve: null });
  },
}));
