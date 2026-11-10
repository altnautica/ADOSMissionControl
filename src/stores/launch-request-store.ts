/**
 * @module launch-request-store
 * @description A point picked on a map for the cockpit Launch sheet: a
 * long-press or right-click on the ground offers "Launch here", which stores
 * the point and the sheet opens with it prefilled as the go-to. One global
 * slot, keyed to the drone it was picked for; the sheet takes it with
 * `consume`, so a request is applied once.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export interface LaunchRequest {
  droneId: string;
  lat: number;
  lon: number;
  /** Metres north of the EKF origin, when the origin is known. */
  north?: number;
  /** Metres east of the EKF origin, when the origin is known. */
  east?: number;
}

export interface PendingLaunchRequest extends LaunchRequest {
  /** When the point was picked (ms since epoch). */
  at: number;
}

interface LaunchRequestState {
  pending: PendingLaunchRequest | null;
  requestLaunch: (request: LaunchRequest) => void;
  /** Take the pending request, clearing it. */
  consume: () => PendingLaunchRequest | null;
}

export const useLaunchRequestStore = create<LaunchRequestState>()((set, get) => ({
  pending: null,
  requestLaunch: (request) => set({ pending: { ...request, at: Date.now() } }),
  consume: () => {
    const pending = get().pending;
    if (pending) set({ pending: null });
    return pending;
  },
}));
