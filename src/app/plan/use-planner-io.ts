/**
 * @module use-planner-io
 * @description Save/load/export handlers and autosave effects for the mission planner.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useDroneManager } from "@/stores/drone-manager";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { useMissionStore } from "@/stores/mission-store";
import { capturePlanExtras, clearPlanWorkspace } from "@/lib/plan-workspace";
import { planSnapshotString } from "@/lib/plan-snapshot";
import {
  autoSave,
  flushAutoSave,
  getAutoSave,
  exportMissionKML,
  exportMissionCSV,
  exportMissionKMZ,
  downloadMissionFile,
  currentExportOptions,
} from "@/lib/mission-io";
import { exportWaypointsFormat, exportQGCPlan } from "@/lib/mission-io-formats";
import type { Waypoint } from "@/lib/types";

interface IODeps {
  waypoints: Waypoint[];
  missionName: string;
  selectedDroneId: string;
  activePlanId: string | null;
  isDirty: boolean;
  libAutoSaveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setWaypoints: (wps: Waypoint[]) => void;
  setMissionName: (name: string) => void;
  setSelectedDroneId: (id: string) => void;
  setSelectedWaypoint: (id: string | null) => void;
  setExpandedWaypoint: (id: string | null) => void;
  setShowDownloadConfirm: (show: boolean) => void;
  downloadMission: () => Promise<Waypoint[]>;
  toast: (message: string, status?: "success" | "warning" | "error" | "info") => void;
}

export function usePlannerIO(deps: IODeps) {
  const {
    waypoints, missionName, selectedDroneId, activePlanId, isDirty,
    libAutoSaveTimer, setWaypoints, setMissionName, setSelectedDroneId,
    setSelectedWaypoint, setExpandedWaypoint, setShowDownloadConfirm,
    downloadMission, toast,
  } = deps;
  const t = useTranslations("plannerIo");

  // Every field `capturePlanExtras` reads, selected individually so a fence /
  // rally / POI edit re-runs the autosave and dirty effects below. Without
  // these subscriptions an edit to a fence was not even considered unsaved.
  const fenceEnabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const fenceMaxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const fenceMinAltitude = useGeofenceStore((s) => s.minAltitude);
  const fenceBreachAction = useGeofenceStore((s) => s.breachAction);
  const fencePolygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const fenceCircleCenter = useGeofenceStore((s) => s.circleCenter);
  const fenceCircleRadius = useGeofenceStore((s) => s.circleRadius);
  const fenceZones = useGeofenceStore((s) => s.zones);
  const rallyPoints = useRallyStore((s) => s.points);
  const poiPoints = usePlanPoiStore((s) => s.points);

  const extras = useMemo(
    () => capturePlanExtras(),
    [
      fenceEnabled, fenceType, fenceMaxAltitude, fenceMinAltitude, fenceBreachAction,
      fencePolygonPoints, fenceCircleCenter, fenceCircleRadius, fenceZones,
      rallyPoints, poiPoints,
    ],
  );

  // ── Autosave recovery ─────────────────────────────────────
  //
  // Restore ONLY into an empty planner. Restoring unconditionally clobbered an
  // active plan: the async read resolved after the plan had loaded and replaced
  // its waypoints with a stale autosave.
  const autoSaveChecked = useRef(false);
  useEffect(() => {
    if (autoSaveChecked.current) return;
    autoSaveChecked.current = true;
    (async () => {
      const saved = await getAutoSave();
      if (!saved) return;
      const mission = useMissionStore.getState();
      const lib = usePlanLibraryStore.getState();
      if (mission.waypoints.length > 0 || lib.activePlanId) {
        // Something is already loaded. Leave the autosave on disk; recovering
        // it now would silently discard the operator's current plan.
        return;
      }
      toast(t("restoringAutosave"), "info");
      setWaypoints(saved.waypoints);
      if (saved.metadata.name) setMissionName(saved.metadata.name);
      if (saved.metadata.droneId) setSelectedDroneId(saved.metadata.droneId);
      // A mission is not just its path: restore the fence, rally and POIs the
      // autosave carried, otherwise recovery silently drops them.
      if (saved.geofence) useGeofenceStore.getState().restore(saved.geofence);
      if (saved.rally && saved.rally.length > 0) {
        useRallyStore.getState().restore({ points: saved.rally });
      }
      if (saved.pois && saved.pois.length > 0) {
        usePlanPoiStore.getState().restore({ points: saved.pois, selectedId: null });
      }
    })();
  }, [setWaypoints, toast, t, setMissionName, setSelectedDroneId]);

  // Auto-save to IndexedDB on any planner change, path or geometry. Flushed on
  // unmount rather than cancelled — cancelling discarded up to the last two
  // seconds of edits every time the operator navigated away.
  useEffect(() => {
    if (waypoints.length > 0) {
      autoSave(waypoints, {
        name: missionName,
        droneId: selectedDroneId || undefined,
      }, extras);
    }
    return () => { void flushAutoSave(); };
  }, [waypoints, missionName, selectedDroneId, extras]);

  // Warn before the tab closes with unsaved work, and flush the pending
  // autosave so a confirmed close still leaves a recoverable mission.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void flushAutoSave();
      e.preventDefault();
      // Legacy browsers need a non-empty returnValue to show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Auto-save to library plan (debounced 3s)
  useEffect(() => {
    const libStore = usePlanLibraryStore.getState();
    if (!libStore.activePlanId || waypoints.length === 0) return;
    clearTimeout(libAutoSaveTimer.current ?? undefined);
    libAutoSaveTimer.current = setTimeout(() => {
      const current = usePlanLibraryStore.getState();
      if (!current.activePlanId || !current.isDirty) return;
      current.savePlan(current.activePlanId, waypoints, {
        droneId: selectedDroneId || undefined,
      }, capturePlanExtras());
    }, 3000);
    return () => { clearTimeout(libAutoSaveTimer.current ?? undefined); };
  }, [waypoints, selectedDroneId, libAutoSaveTimer, extras]);

  // Auto-sync plan name to library
  useEffect(() => {
    const libStore = usePlanLibraryStore.getState();
    if (!libStore.activePlanId || !missionName) return;
    libStore.updatePlanName(libStore.activePlanId, missionName);
  }, [missionName]);

  // Dirty detection over the WHOLE plan — path plus fence, rally and POIs.
  useEffect(() => {
    const libStore = usePlanLibraryStore.getState();
    if (!libStore.activePlanId) return;
    const contentDirty = planSnapshotString(waypoints, extras) !== libStore.savedSnapshot;
    const plan = libStore.plans.find((p) => p.id === libStore.activePlanId);
    const nameDirty = plan ? plan.name !== missionName : false;
    libStore.setDirty(contentDirty || nameDirty);
  }, [waypoints, missionName, extras]);

  // ── Save/Load handlers ────────────────────────────────────
  const handleSave = useCallback(() => {
    const libStore = usePlanLibraryStore.getState();
    if (libStore.activePlanId) {
      if (missionName) libStore.updatePlanName(libStore.activePlanId, missionName);
      libStore.savePlan(libStore.activePlanId, waypoints, {
        droneId: selectedDroneId || undefined,
        totalDistance: undefined, estimatedTime: undefined,
      }, capturePlanExtras());
    } else {
      libStore.createPlan(missionName || t("untitledPlan"), waypoints, {
        droneId: selectedDroneId || undefined,
      }, capturePlanExtras());
    }
    if (libAutoSaveTimer.current) clearTimeout(libAutoSaveTimer.current);
    useSettingsStore.getState().incrementSaveCount();
    toast(t("planSaved"), "success");
  }, [waypoints, missionName, selectedDroneId, toast, t, libAutoSaveTimer]);

  const handleSaveAs = useCallback(() => {
    const libStore = usePlanLibraryStore.getState();
    libStore.createPlan(missionName || t("untitledPlan"), waypoints, {
      droneId: selectedDroneId || undefined,
    }, capturePlanExtras());
    useSettingsStore.getState().incrementSaveCount();
    toast(t("planSavedAsCopy"), "success");
  }, [waypoints, missionName, selectedDroneId, toast, t]);

  const handleExportWaypoints = useCallback(() => {
    exportWaypointsFormat(waypoints, missionName || "mission", currentExportOptions());
    toast(t("exported", { format: ".waypoints" }), "success");
  }, [waypoints, missionName, toast, t]);

  const handleExportPlan = useCallback(() => {
    exportQGCPlan(waypoints, missionName || "mission", undefined, capturePlanExtras(), currentExportOptions());
    toast(t("exported", { format: ".plan" }), "success");
  }, [waypoints, missionName, toast, t]);

  const handleExportKML = useCallback(() => {
    exportMissionKML(waypoints, missionName || "mission");
    toast(t("exported", { format: ".kml" }), "success");
  }, [waypoints, missionName, toast, t]);

  const handleExportCSV = useCallback(() => {
    exportMissionCSV(waypoints, missionName || "mission");
    toast(t("exported", { format: ".csv" }), "success");
  }, [waypoints, missionName, toast, t]);

  const handleExportKMZ = useCallback(async () => {
    await exportMissionKMZ(waypoints, missionName || "mission");
    toast(t("exported", { format: ".kmz" }), "success");
  }, [waypoints, missionName, toast, t]);

  const handleExportNative = useCallback(() => {
    // Native .altmission format — captures the whole plan (path + fence + rally),
    // unlike the interchange formats which drop fields on round-trip.
    downloadMissionFile(waypoints, {
      name: missionName || "mission",
      droneId: selectedDroneId || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, capturePlanExtras());
    toast(t("exported", { format: ".altmission" }), "success");
  }, [waypoints, missionName, selectedDroneId, toast, t]);

  const handlePlanLoaded = useCallback(
    (plan: { name: string; droneId?: string }) => {
      setMissionName(plan.name);
      setSelectedDroneId(plan.droneId || "");
    },
    [setMissionName, setSelectedDroneId]
  );

  const handlePlanRenamed = useCallback((name: string) => { setMissionName(name); }, [setMissionName]);

  const handleNewPlan = useCallback(() => {
    const libStore = usePlanLibraryStore.getState();
    libStore.createPlan();
    clearPlanWorkspace();
    setMissionName(t("untitledPlan"));
    setSelectedDroneId("");
    setSelectedWaypoint(null);
    setExpandedWaypoint(null);
    toast(t("newPlanCreated"), "info");
  }, [setSelectedWaypoint, setExpandedWaypoint, toast, t, setMissionName, setSelectedDroneId]);

  const handleFocusSearch = useCallback(() => {
    document.dispatchEvent(new CustomEvent("plan-library:focus-search"));
  }, []);

  // ── Download from drone ───────────────────────────────────
  const executeDownloadFromDrone = useCallback(async () => {
    const downloaded = await downloadMission();
    // A truncated or stalled transfer rejects inside the adapter and the
    // store catches it into `downloadState: "error"` with an empty list. That
    // is NOT "no mission on the drone" — saying so would tell the operator the
    // aircraft is empty when the download simply failed, and previously the
    // short list was loaded as if it were the mission.
    const { downloadState, downloadError, downloadWarnings } = useMissionStore.getState();
    if (downloadState === "error") {
      toast(
        downloadError
          ? t("downloadFailedWithError", { error: downloadError })
          : t("downloadFailed"),
        "error",
      );
      return;
    }
    for (const warning of downloadWarnings) toast(warning, "warning");
    // The store leaves the open plan untouched when the vehicle holds nothing.
    if (downloaded.length === 0) { toast(t("vehicleHasNoMission"), "info"); return; }
    const time = new Date().toLocaleTimeString("en-US", { hour12: false });
    const name = t("droneMissionName", { time });
    const libStore = usePlanLibraryStore.getState();
    libStore.createPlan(name, downloaded);
    setMissionName(name);
    setSelectedDroneId(selectedDroneId);
    usePlannerStore.getState().requestFit();
    toast(t("loadedFromDrone", { count: downloaded.length }), "success");
  }, [downloadMission, selectedDroneId, toast, t, setMissionName, setSelectedDroneId]);

  const handleDownloadFromDrone = useCallback(() => {
    const droneManager = useDroneManager.getState();
    const hasDrone = droneManager.selectedDroneId !== null || droneManager.drones.size > 0;
    if (!hasDrone) { toast(t("connectDroneFirst"), "info"); return; }
    if (isDirty && activePlanId) { setShowDownloadConfirm(true); return; }
    executeDownloadFromDrone();
  }, [isDirty, activePlanId, executeDownloadFromDrone, toast, t, setShowDownloadConfirm]);

  const handleSaveAndDownload = useCallback(() => {
    handleSave();
    setShowDownloadConfirm(false);
    executeDownloadFromDrone();
  }, [handleSave, executeDownloadFromDrone, setShowDownloadConfirm]);

  const handleDiscardAndDownload = useCallback(() => {
    setShowDownloadConfirm(false);
    executeDownloadFromDrone();
  }, [executeDownloadFromDrone, setShowDownloadConfirm]);

  const handleCancelDownload = useCallback(() => { setShowDownloadConfirm(false); }, [setShowDownloadConfirm]);

  return {
    handleSave, handleSaveAs,
    handleExportWaypoints, handleExportPlan, handleExportKML, handleExportCSV,
    handleExportKMZ, handleExportNative,
    handlePlanLoaded, handlePlanRenamed, handleNewPlan, handleFocusSearch,
    handleDownloadFromDrone, handleSaveAndDownload, handleDiscardAndDownload, handleCancelDownload,
  };
}
