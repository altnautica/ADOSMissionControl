/**
 * @module DemoMissionSync
 * @description Seeds the five demo missions into the plan library while demo mode
 * is on, and tears them down cleanly when it turns off. Mounted by DemoProvider
 * only in demo mode, so this component's mount/unmount brackets demo on/off. The
 * demo plans carry their own geofence + rally, so the normal load path restores
 * them; this component only owns seeding, the plan opened on start, and teardown.
 * A plan already open when demo starts (a reload) keeps its live workspace, so
 * unsaved edits to its path, fence and rally points survive the reload.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import {
  usePlanLibraryStore,
  libraryHydrationSettled,
  onLibraryHydrationSettled,
} from "@/stores/plan-library-store";
import {
  useMissionStore,
  missionHydrationSettled,
  onMissionHydrationSettled,
} from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { applyPlanToWorkspace } from "@/lib/plan-workspace";
import type { SavedPlan } from "@/lib/types";
import { DEMO_PLANS, DEMO_MISSION_FOLDER } from "@/mock/demo-missions";
import { DEMO_MISSION_FOLDER_ID, isDemoPlanId } from "@/lib/demo/demo-ids";

/**
 * The plan to open when demo mode starts: the plan that was open before (a
 * reload keeps it), else the first demo mission.
 */
export function demoStartPlan(activePlanId: string | null, plans: readonly SavedPlan[]): SavedPlan {
  return plans.find((p) => p.id === activePlanId) ?? DEMO_PLANS[0];
}

/**
 * The demo plan open when demo mode last stopped. Teardown clears the active
 * plan (the demo plans leave the library), so a restart in the same session
 * (demo toggled back on, or a remount) reopens this one.
 */
let lastDemoPlanId: string | null = null;

/** Seed the demo plans and open the start plan; returns the teardown. */
export function seedDemoMissions(): () => void {
  const lib = usePlanLibraryStore.getState();

  // Capture the user's real workspace so teardown restores it. A demo plan left
  // open by an earlier session is not the user's and is not restored.
  const prevActivePlanId = lib.activePlanId && !isDemoPlanId(lib.activePlanId) ? lib.activePlanId : null;
  const prevWaypoints = useMissionStore.getState().waypoints;
  const prevSavedSnapshot = lib.savedSnapshot;
  const prevGeofence = useGeofenceStore.getState().snapshot();
  const prevRally = useRallyStore.getState().snapshot();

  // Idempotent insert of the demo folder + plans (skip ids already present).
  const existing = new Set(lib.plans.map((p) => p.id));
  const missing = DEMO_PLANS.filter((p) => !existing.has(p.id));
  usePlanLibraryStore.setState((s) => ({
    plans: [...missing, ...s.plans],
    folders: s.folders.some((f) => f.id === DEMO_MISSION_FOLDER_ID) ? s.folders : [...s.folders, DEMO_MISSION_FOLDER],
    expandedFolders: s.expandedFolders.includes(DEMO_MISSION_FOLDER_ID) ? s.expandedFolders : [...s.expandedFolders, DEMO_MISSION_FOLDER_ID],
  }));

  // Open the start plan in both tabs (restores its fence + rally + fit). The
  // plan already open (a reload) is left as the persisted workspace holds it:
  // reloading its saved copy would drop the edits made since the last save.
  const after = usePlanLibraryStore.getState();
  const start = demoStartPlan(after.activePlanId ?? lastDemoPlanId, after.plans);
  if (start.id !== after.activePlanId) applyPlanToWorkspace(start);

  return () => {
    const open = usePlanLibraryStore.getState().activePlanId;
    lastDemoPlanId = open && isDemoPlanId(open) ? open : null;
    // Remove the demo plans + folder and restore the user's prior workspace in
    // one set() — avoiding a transient null activePlanId the sim guard trips on.
    usePlanLibraryStore.setState((s) => ({
      plans: s.plans.filter((p) => !isDemoPlanId(p.id)),
      folders: s.folders.filter((f) => f.id !== DEMO_MISSION_FOLDER_ID),
      expandedFolders: s.expandedFolders.filter((id) => id !== DEMO_MISSION_FOLDER_ID),
      activePlanId: prevActivePlanId,
      isDirty: false,
      savedSnapshot: prevSavedSnapshot,
    }));
    if (prevActivePlanId === null) useMissionStore.getState().clearMission();
    else useMissionStore.getState().setWaypoints(prevWaypoints);
    useGeofenceStore.getState().restore(prevGeofence);
    useRallyStore.getState().restore(prevRally);
  };
}

export function DemoMissionSync() {
  useEffect(() => {
    // Seed only once the persisted library and plan have loaded, so the plan
    // the operator had open is known (and the load cannot overwrite the seed).
    let teardown: (() => void) | null = null;
    let stopped = false;
    const run = () => {
      if (stopped || teardown || !libraryHydrationSettled() || !missionHydrationSettled()) return;
      teardown = seedDemoMissions();
    };
    const unsubscribe = [onLibraryHydrationSettled(run), onMissionHydrationSettled(run)];
    run();
    return () => {
      stopped = true;
      unsubscribe.forEach((u) => u());
      teardown?.();
    };
  }, []);

  return null;
}
