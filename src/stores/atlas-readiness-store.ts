"use client";

/**
 * @module atlas-readiness-store
 * @description Per-drone Atlas capture-readiness cache, keyed by the bare device
 * id. `use-atlas-control` polls `GET /api/atlas/readiness` for the focused drone
 * (local-first) and writes the snapshot here; the node-detail surface reads
 * {@link AtlasReadinessState.isCapturing} to decide whether the "Live World"
 * tab is shown — one tab when the drone is not capturing, two while it is.
 *
 * Every polled snapshot carries an expiry of three poll intervals past the
 * moment it was observed. A node that powers off mid-capture stops answering,
 * its snapshot expires, and every reader sees "no readiness" instead of the
 * last "capturing" forever. A demo snapshot is simulated, not observed, and
 * carries no expiry.
 *
 * Not persisted: readiness is live agent state, re-fetched on tab mount.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import {
  isActiveCaptureState,
  type AtlasReadiness,
} from "@/lib/agent/atlas-control-client";

/** One cached snapshot and the instant it stops being current. */
export interface AtlasReadinessSnapshot {
  readiness: AtlasReadiness;
  /** Epoch ms after which the snapshot is no longer current; null = simulated (demo). */
  expiresAt: number | null;
}

/** The snapshot's readiness while it is current at `now`, otherwise null. */
export function currentReadiness(
  snapshot: AtlasReadinessSnapshot | undefined,
  now: number,
): AtlasReadiness | null {
  if (!snapshot) return null;
  return snapshot.expiresAt === null || now < snapshot.expiresAt ? snapshot.readiness : null;
}

interface AtlasReadinessState {
  /** Last snapshot per bare device id, current or expired. */
  snapshots: Record<string, AtlasReadinessSnapshot>;
  /** Store (replace) the snapshot for a device. */
  setReadiness: (deviceId: string, readiness: AtlasReadiness, expiresAt: number | null) => void;
  /** Drop the readiness for a device (e.g. on unpair). */
  clear: (deviceId: string) => void;
  /** The device's readiness if its snapshot is current at `now`, or null. */
  getReadiness: (deviceId: string, now: number) => AtlasReadiness | null;
  /** Whether the device is actively capturing at `now`. Derived from BOTH the
   * standalone `capturing` bool AND the lifecycle `state` (capturing / paused /
   * finalizing) so a paused session — where an agent may report
   * `capturing:false` while `state:"paused"` — still keeps the Live World tab
   * visible. An expired snapshot is not capturing. */
  isCapturing: (deviceId: string, now: number) => boolean;
}

export const useAtlasReadinessStore = create<AtlasReadinessState>((set, get) => ({
  snapshots: {},
  setReadiness: (deviceId, readiness, expiresAt) =>
    set((state) => ({
      snapshots: { ...state.snapshots, [deviceId]: { readiness, expiresAt } },
    })),
  clear: (deviceId) =>
    set((state) => {
      if (!(deviceId in state.snapshots)) return state;
      const next = { ...state.snapshots };
      delete next[deviceId];
      return { snapshots: next };
    }),
  getReadiness: (deviceId, now) => currentReadiness(get().snapshots[deviceId], now),
  isCapturing: (deviceId, now) => {
    const r = currentReadiness(get().snapshots[deviceId], now);
    return r ? r.capturing === true || isActiveCaptureState(r.state) : false;
  },
}));
