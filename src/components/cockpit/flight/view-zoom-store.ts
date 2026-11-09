/**
 * @module cockpit/flight/view-zoom-store
 * @description The digital zoom of the main picture, per drone: 1x, 2x or
 * 4x. Used when no camera extension offers an optical zoom; the data layers
 * scale with the picture, so boxes stay on their targets.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export const ZOOM_STEPS = [1, 2, 4] as const;
export type ViewZoom = (typeof ZOOM_STEPS)[number];

interface ViewZoomState {
  byDrone: Record<string, ViewZoom>;
  /** Next step, wrapping from the largest back to 1x (the on-screen button). */
  cycle: (droneId: string) => void;
  /** One step in or out, held at the ends (controller zoom in / out). */
  step: (droneId: string, by: 1 | -1) => void;
}

export const useViewZoomStore = create<ViewZoomState>()((set) => ({
  byDrone: {},
  cycle: (droneId) =>
    set((s) => {
      const i = ZOOM_STEPS.indexOf(s.byDrone[droneId] ?? 1);
      return { byDrone: { ...s.byDrone, [droneId]: ZOOM_STEPS[(i + 1) % ZOOM_STEPS.length] } };
    }),
  step: (droneId, by) =>
    set((s) => {
      const i = ZOOM_STEPS.indexOf(s.byDrone[droneId] ?? 1);
      const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + by))];
      return { byDrone: { ...s.byDrone, [droneId]: next } };
    }),
}));
