/**
 * @module launch-request-store
 * @description A point picked on a map for the cockpit Launch sheet: a
 * long-press or right-click on the ground offers "Launch here", which stores
 * the point and the sheet opens with it prefilled as the go-to. One global
 * slot, keyed to the drone it was picked for; the sheet takes it with
 * `consume`, so a request is applied once. A request older than
 * {@link LAUNCH_REQUEST_TTL_MS} is dropped, never applied: the operator has
 * moved on, and a later visit to the cockpit must not open Launch with it.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** How long a picked point waits for the cockpit to take it (ms). */
export const LAUNCH_REQUEST_TTL_MS = 5000;

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

/** `pending` when it is `droneId`'s and still within its time, else null. */
export function liveLaunchRequest(
  pending: PendingLaunchRequest | null,
  droneId: string,
  now: number = Date.now(),
): PendingLaunchRequest | null {
  return pending && pending.droneId === droneId && now - pending.at <= LAUNCH_REQUEST_TTL_MS ? pending : null;
}

interface LaunchRequestState {
  pending: PendingLaunchRequest | null;
  requestLaunch: (request: LaunchRequest) => void;
  /** Take the pending request, clearing it; a stale one is cleared and not returned. */
  consume: () => PendingLaunchRequest | null;
}

export const useLaunchRequestStore = create<LaunchRequestState>()((set, get) => ({
  pending: null,
  requestLaunch: (request) => set({ pending: { ...request, at: Date.now() } }),
  consume: () => {
    const pending = get().pending;
    if (!pending) return null;
    set({ pending: null });
    return Date.now() - pending.at <= LAUNCH_REQUEST_TTL_MS ? pending : null;
  },
}));
