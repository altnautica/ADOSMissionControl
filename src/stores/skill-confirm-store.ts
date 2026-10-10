/**
 * The ctx.confirm seam. The skill dispatcher pushes a ConfirmPolicy here and
 * awaits the operator's decision; the SkillConfirmHost renders the matching
 * confirm sheet and resolves the pending promise. One pending request at a
 * time — a new request resolves any prior one as cancelled so sheets never
 * stack.
 *
 * @module skill-confirm-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  ConfirmChoice,
  ConfirmPolicy,
  ConfirmResult,
} from "@/lib/skills/types";

export interface PendingConfirm {
  /** Monotonic, identifies this request. */
  id: number;
  policy: ConfirmPolicy;
  /** The drone the confirmed action targets; null when the request names none. */
  droneId: string | null;
  resolve: (result: ConfirmResult) => void;
}

interface SkillConfirmState {
  pending: PendingConfirm | null;
  /** Internal monotonic counter for request ids. */
  _nextId: number;
  /**
   * Pushed by the dispatcher's ctx.confirm. Returns a promise the gate awaits.
   * If a confirm is already pending, the prior one resolves(false) first
   * (re-entrancy guard / no stacked sheets). `droneId` names the target so
   * checklist-aware policies read that drone's checklist.
   */
  request: (policy: ConfirmPolicy, droneId?: string) => Promise<ConfirmResult>;
  /**
   * Resolves the pending request with the operator's decision + clears it. A
   * confirmed request may carry the values the operator set on the sheet.
   */
  resolvePending: (confirmed: boolean, choice?: ConfirmChoice) => void;
}

export const useSkillConfirmStore = create<SkillConfirmState>((set, get) => ({
  pending: null,
  _nextId: 1,

  request: (policy, droneId) => {
    // A tap-tier policy is confirmed by the press that raised it.
    if (policy.gesture === "tap") return Promise.resolve(true);
    return new Promise<ConfirmResult>((resolve) => {
      // Re-entrancy guard: a new request cancels any prior pending one so two
      // sheets never render at once.
      const prior = get().pending;
      if (prior) {
        prior.resolve(false);
      }
      const id = get()._nextId;
      set({ pending: { id, policy, droneId: droneId ?? null, resolve }, _nextId: id + 1 });
    });
  },

  resolvePending: (confirmed, choice) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(confirmed ? (choice ?? true) : false);
  },
}));
