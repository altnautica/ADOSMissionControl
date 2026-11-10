/**
 * @module cockpit/views
 * @description The cockpit view per drone (`pilot`, `map`, `split`,
 * `vision`), taken from the shared cockpit spec `views.json`. Triangle tap
 * and the `V` key cycle the spec's order; the stream choice (EO, IR, down) is
 * separate and lives in the video streams store.
 *
 * The view is kept for the session only: a cockpit always opens on the spec
 * default so the operator sees the video first.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import viewsSpec from "@/lib/cockpit-spec/views.json";
import type { LayerStackView } from "@/lib/cockpit/layers/layer-spec";

export type CockpitViewId = LayerStackView;

export interface CockpitViewDef {
  id: CockpitViewId;
  label: string;
  /** What fills the cockpit: the video or the map. */
  main: "video" | "map";
  /** The second pane: the video as a PiP, the map beside the video, or none. */
  secondary: "video_pip" | "map" | null;
  /** The vision view's side panel. */
  sidePanel: boolean;
}

const VIEW_IDS: readonly CockpitViewId[] = ["pilot", "map", "split", "vision"];

function isViewId(v: unknown): v is CockpitViewId {
  return typeof v === "string" && (VIEW_IDS as readonly string[]).includes(v);
}

export const COCKPIT_VIEWS: readonly CockpitViewDef[] = viewsSpec.views
  .filter((v) => isViewId(v.id))
  .map((v) => ({
    id: v.id as CockpitViewId,
    label: v.label,
    main: v.main === "map" ? "map" : "video",
    secondary: v.secondary === "video_pip" ? "video_pip" : v.secondary === "map" ? "map" : null,
    sidePanel: Array.isArray(v.side_panel) && v.side_panel.length > 0,
  }));

export const VIEW_CYCLE: readonly CockpitViewId[] = viewsSpec.cycle.filter(isViewId);
export const DEFAULT_VIEW: CockpitViewId = isViewId(viewsSpec.default) ? viewsSpec.default : "pilot";
/** The keyboard key that cycles the view (`v`). */
export const VIEW_CYCLE_KEY: string = viewsSpec.cycle_keys.keyboard;

export function viewDef(id: CockpitViewId): CockpitViewDef {
  return COCKPIT_VIEWS.find((v) => v.id === id) ?? COCKPIT_VIEWS[0];
}

/** The view after `id` in the spec's cycle. */
export function nextView(id: CockpitViewId): CockpitViewId {
  const i = VIEW_CYCLE.indexOf(id);
  return VIEW_CYCLE[(i + 1) % VIEW_CYCLE.length] ?? DEFAULT_VIEW;
}

interface CockpitViewState {
  byDrone: Record<string, CockpitViewId>;
  setView: (droneId: string, view: CockpitViewId) => void;
  cycleView: (droneId: string) => void;
}

export const useCockpitViewStore = create<CockpitViewState>()((set) => ({
  byDrone: {},
  setView: (droneId, view) => set((s) => ({ byDrone: { ...s.byDrone, [droneId]: view } })),
  cycleView: (droneId) =>
    set((s) => ({ byDrone: { ...s.byDrone, [droneId]: nextView(s.byDrone[droneId] ?? DEFAULT_VIEW) } })),
}));

/** The drone's current cockpit view. */
export function useCockpitView(droneId: string): CockpitViewId {
  return useCockpitViewStore((s) => s.byDrone[droneId] ?? DEFAULT_VIEW);
}
