/**
 * @module plan-workspace
 * @description Shared "load a saved plan into the live planner workspace" logic.
 * A saved plan owns not just waypoints but its geofence + rally geometry +
 * plan-attached points of interest, which live in dedicated stores. Loading a
 * plan must restore all of them (and clear them when the plan has none) so a
 * plan round-trips fully across save/load and across the Plan <-> Simulate tabs.
 * Used by the plan library and the demo seed.
 * @license GPL-3.0-only
 */

import { usePlanLibraryStore, type PlanExtras } from "@/stores/plan-library-store";
import { useMissionStore } from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { usePlannerStore } from "@/stores/planner-store";
import { planSnapshotString } from "@/lib/plan-snapshot";
import { clearHistory } from "@/lib/planner-history";
import type { SavedPlan } from "@/lib/types";

/**
 * Load a saved plan into the live workspace: set it active, load its waypoints,
 * restore (or clear) its geofence + rally geometry, and request a map fit so the
 * plan is framed on screen.
 */
export function applyPlanToWorkspace(plan: SavedPlan): void {
  const lib = usePlanLibraryStore.getState();
  lib.setActivePlan(plan.id);
  useMissionStore.getState().setWaypoints(plan.waypoints);
  lib.setSavedSnapshot(
    planSnapshotString(plan.waypoints, {
      geofence: plan.geofence,
      rally: plan.rally,
      pois: plan.pois,
    }),
  );

  const geofence = useGeofenceStore.getState();
  if (plan.geofence) geofence.restore(plan.geofence);
  else geofence.clearFence();

  const rally = useRallyStore.getState();
  if (plan.rally && plan.rally.length > 0) rally.restore({ points: plan.rally });
  else rally.clearPoints();

  const poi = usePlanPoiStore.getState();
  if (plan.pois && plan.pois.length > 0) poi.restore({ points: plan.pois, selectedId: null });
  else poi.clearPoints();

  // The undo timeline belongs to one plan. Without this, Ctrl+Z after a load
  // restored the previous plan's content into this one, and the library
  // autosave then wrote it over this plan.
  clearHistory();

  usePlannerStore.getState().requestFit();
}

/**
 * Save the live workspace (waypoints plus fence, rally and POIs) into the
 * active library plan, or into a new plan when none is active. Works from any
 * surface that shows the library, not only the Plan page.
 */
export function saveActivePlanFromWorkspace(): void {
  const lib = usePlanLibraryStore.getState();
  const { waypoints } = useMissionStore.getState();
  if (lib.activePlanId) lib.savePlan(lib.activePlanId, waypoints, undefined, capturePlanExtras());
  else lib.createPlan(undefined, waypoints, undefined, capturePlanExtras());
}

/**
 * Whether loading a plan now would discard work: the active plan differs from
 * its saved snapshot, or no plan is active and the workspace holds a path,
 * fence, rally points or POIs that were never saved. Computed from the live
 * stores rather than the planner's `isDirty` flag, which only the Plan page
 * keeps current.
 */
export function workspaceHasUnsavedChanges(): boolean {
  const lib = usePlanLibraryStore.getState();
  const { waypoints } = useMissionStore.getState();
  const extras = capturePlanExtras();
  if (!lib.activePlanId) {
    return (
      waypoints.length > 0 ||
      extras.geofence !== undefined ||
      extras.rally !== undefined ||
      extras.pois !== undefined
    );
  }
  return lib.isDirty || planSnapshotString(waypoints, extras) !== lib.savedSnapshot;
}

/**
 * Capture the current geofence + rally + POI geometry to persist alongside a
 * plan. Returns `undefined` for a domain with no meaningful content so plans
 * stay lean and `plan.geofence`/`plan.rally`/`plan.pois` presence is a truthful
 * "has a fence/rally/poi".
 */
export function capturePlanExtras(): PlanExtras {
  const geo = useGeofenceStore.getState();
  const hasFence =
    geo.enabled ||
    geo.polygonPoints.length > 0 ||
    geo.circleCenter !== null ||
    geo.zones.length > 0;
  const rallyPoints = useRallyStore.getState().points;
  const poiPoints = usePlanPoiStore.getState().points;
  return {
    geofence: hasFence ? geo.snapshot() : undefined,
    rally: rallyPoints.length > 0 ? rallyPoints.map((p) => ({ ...p })) : undefined,
    pois: poiPoints.length > 0 ? poiPoints.map((p) => ({ ...p })) : undefined,
  };
}
