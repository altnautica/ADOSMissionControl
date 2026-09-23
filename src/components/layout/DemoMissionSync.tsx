/**
 * @module DemoMissionSync
 * @description Seeds the five demo missions into the plan library while demo mode
 * is on, and tears them down cleanly when it turns off. Mounted by DemoProvider
 * only in demo mode, so this component's mount/unmount brackets demo on/off. The
 * demo plans carry their own geofence + rally, so the normal load path restores
 * them; this component only owns seeding, first-mission open, and teardown.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useMissionStore } from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { applyPlanToWorkspace } from "@/lib/plan-workspace";
import { DEMO_PLANS, DEMO_MISSION_FOLDER } from "@/mock/demo-missions";
import { DEMO_MISSION_FOLDER_ID, isDemoPlanId } from "@/lib/demo/demo-ids";

export function DemoMissionSync() {
  useEffect(() => {
    const lib = usePlanLibraryStore.getState();

    // Capture the user's real workspace so teardown restores it exactly.
    const prevActivePlanId = lib.activePlanId;
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

    // Open the first demo mission in both tabs (restores its fence + rally + fit).
    applyPlanToWorkspace(DEMO_PLANS[0]);

    return () => {
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
  }, []);

  return null;
}
