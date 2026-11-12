/**
 * @module cockpit/stream-quality
 * @description The operator's Stream quality choice for a drone's LAN feed
 * (spec `camera.quality.*`): `high` holds the drone on the `hero` video
 * profile through the shared lease while a detail surface plays it; `auto`
 * takes no hold, so the drone stays on whatever profile the fleet gives it.
 * High is the default, as before the choice existed.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type StreamQuality = "auto" | "high";

export const STREAM_QUALITIES: readonly StreamQuality[] = ["auto", "high"];

interface StreamQualityState {
  byDrone: Record<string, StreamQuality>;
  set: (droneId: string, quality: StreamQuality) => void;
}

export const useStreamQualityStore = create<StreamQualityState>((set) => ({
  byDrone: {},
  set: (droneId, quality) => set((s) => ({ byDrone: { ...s.byDrone, [droneId]: quality } })),
}));

/** A drone's Stream quality; `high` until the operator picks. */
export function streamQualityFor(byDrone: Record<string, StreamQuality>, droneId: string | null | undefined): StreamQuality {
  return (droneId ? byDrone[droneId] : undefined) ?? "high";
}
