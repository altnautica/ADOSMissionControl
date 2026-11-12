/**
 * @module use-planner-actions
 * @description Map handlers and toolbar actions for the mission planner.
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useMissionStore } from "@/stores/mission-store";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { selectedDroneProtocol } from "@/stores/drone-selection";
import { randomId } from "@/lib/utils";
import { acceptRadiusDefault } from "@/components/planner/waypoint-constants";
import { clearAutoSave } from "@/lib/mission-io";
import { useDrawingStore } from "@/stores/drawing-store";
import { useRallyStore } from "@/stores/rally-store";
import { withPlannerHistory } from "@/lib/planner-history";
import { buildResumeMission } from "@/lib/mission/resume";
import { DEFAULT_PLAN_PROFILE, profileFromVehicleInfo } from "@/lib/mission/plan-profile";
import { clampLat, clampLon, clampAlt } from "./use-planner-state";
import type { ContextMenuState, PlannerToast } from "./use-planner-state";
import type { Waypoint } from "@/lib/types";
import type { DroneProtocol } from "@/lib/protocol/types";
import { datumPatternFor } from "@/lib/planner-mode";
import { useDrawingComplete } from "./use-drawing-complete";
import { usePatternApply } from "./use-pattern-apply";
import { useDescribeUploadFailure } from "@/components/planner/use-describe-upload-failure";

interface ActionsDeps {
  waypoints: Waypoint[];
  activePlanId: string | null;
  isDirty: boolean;
  activeTool: string;
  defaultAlt: number;
  defaultSpeed: number;
  defaultAcceptRadius: number;
  selectedDroneId: string;
  missionName: string;
  contextMenu: ContextMenuState | null;
  // Store actions
  addWaypoint: (wp: Waypoint) => void;
  removeWaypoint: (id: string) => void;
  insertWaypoint: (wp: Waypoint, index: number) => void;
  clearMission: () => void;
  setWaypoints: (wps: Waypoint[]) => void;
  downloadMission: () => Promise<Waypoint[]>;
  uploadMission: (target?: DroneProtocol, opts?: { waypoints?: Waypoint[] }) => Promise<boolean>;
  addRallyPoint: (point: { id: string; lat: number; lon: number; alt: number }) => void;
  // State setters
  setContextMenu: (menu: ContextMenuState | null) => void;
  setSelectedWaypoint: (id: string | null) => void;
  setShowClearConfirm: (show: boolean) => void;
  // Optional so the composition layer can omit it; the pattern-apply gate
  // no-ops safely (no destructive apply) until it is provided.
  setShowPatternApplyConfirm?: (show: boolean) => void;
  setShowDownloadConfirm: (show: boolean) => void;
  toast: PlannerToast;
}

/**
 * Map toolbar tool -> the NAVIGATION command it places. `roi` is deliberately
 * absent: ROI is an action, not a navigation command, so placing it as its own
 * top-level row produced a mission the validator rejects (`ACTION_AS_NAV`) and
 * the FC mis-sequences. The ROI tool attaches an action to the nearest
 * waypoint instead — see `attachRoiAction`.
 */
const TOOL_COMMAND_MAP: Record<string, Waypoint["command"]> = {
  select: "WAYPOINT",
  waypoint: "WAYPOINT",
  takeoff: "TAKEOFF",
  land: "LAND",
  // A timed loiter: the operator sets the hold. An unlimited LOITER never
  // advances on its own, so it is never placed by a click.
  loiter: "LOITER_TIME",
};

/** Items a plan starts with that Reverse keeps first. */
const LEADING_COMMANDS: Record<string, true> = { TAKEOFF: true, VTOL_TAKEOFF: true };
/** Items a plan ends with that Reverse keeps last. */
const TRAILING_COMMANDS: Record<string, true> = { RTL: true, LAND: true, VTOL_LAND: true };
/** Items whose altitude says nothing about the height to fly on to the next point. */
const GROUND_END_COMMANDS: Record<string, true> = { RTL: true, LAND: true, VTOL_LAND: true };

/**
 * The frame a newly placed waypoint is stamped with: the planner default at the
 * moment of placement. Stored on the waypoint so a later change of the default
 * never changes what this altitude means.
 */
const placementFrame = () => usePlannerStore.getState().defaultFrame;

/**
 * A plain waypoint inserted after `prev` at `at`: it flies at `prev`'s altitude
 * in `prev`'s frame and speed, so inserting into a leg never changes the
 * height the leg is flown at. After an RTL or LAND, whose altitude is not a
 * flying height, it takes the planner's default altitude and frame.
 */
export function waypointForInsert(prev: Waypoint, at: { lat: number; lon: number }): Waypoint {
  const planner = usePlannerStore.getState();
  const groundEnd = GROUND_END_COMMANDS[prev.command ?? "WAYPOINT"] === true;
  return {
    id: randomId(),
    lat: clampLat(at.lat),
    lon: clampLon(at.lon),
    alt: groundEnd ? clampAlt(planner.defaultAlt) : prev.alt,
    frame: groundEnd ? planner.defaultFrame : prev.frame ?? planner.defaultFrame,
    ...(prev.speed !== undefined ? { speed: prev.speed } : {}),
    command: "WAYPOINT",
    ...acceptRadiusDefault("WAYPOINT", planner.defaultAcceptRadius),
  };
}

/**
 * The plan in reverse flight order, with a leading TAKEOFF and a trailing
 * RTL / LAND kept where they are: the vehicle still takes off first and
 * returns or lands last.
 */
export function reverseWaypoints(waypoints: readonly Waypoint[]): Waypoint[] {
  const start = waypoints.length > 0 && LEADING_COMMANDS[waypoints[0].command ?? "WAYPOINT"] ? 1 : 0;
  const last = waypoints.length - 1;
  const end = last >= start && TRAILING_COMMANDS[waypoints[last].command ?? "WAYPOINT"] ? last : waypoints.length;
  return [...waypoints.slice(0, start), ...waypoints.slice(start, end).reverse(), ...waypoints.slice(end)];
}

/**
 * Attach an ROI action to a navigation waypoint. ROI is a non-navigation
 * command: on the wire it is a mission item sequenced after the waypoint it
 * fires at, so it must ride in that waypoint's `actions[]`. Returns false when
 * there is no waypoint to attach to.
 */
function attachRoiAction(
  waypoints: readonly Waypoint[],
  lat: number,
  lon: number,
  alt: number,
): boolean {
  const parent = waypoints[waypoints.length - 1];
  if (!parent) return false;
  useMissionStore.getState().updateWaypoint(parent.id, {
    actions: [
      ...(parent.actions ?? []),
      { id: randomId(), command: "ROI", lat, lon, alt },
    ],
  });
  return true;
}

export function usePlannerActions(deps: ActionsDeps) {
  const {
    waypoints, activePlanId, activeTool, defaultAlt, defaultSpeed, defaultAcceptRadius,
    contextMenu,
    addWaypoint, removeWaypoint, insertWaypoint, clearMission, setWaypoints,
    uploadMission,
    addRallyPoint, setContextMenu, setSelectedWaypoint,
    setShowClearConfirm, setShowPatternApplyConfirm,
    toast,
  } = deps;
  const t = useTranslations("planner.toast");
  const describeUploadFailure = useDescribeUploadFailure();

  const handleMapClick = useCallback(
    (lat: number, lon: number) => {
      if (activeTool === "rally") {
        // A rally point belongs to a plan; with none open it would belong to nothing.
        if (!activePlanId) { toast(t("openPlanFirst"), "info"); return; }
        // Sticky: keep placing rally points until the tool is switched.
        addRallyPoint({ id: randomId(), lat: clampLat(lat), lon: clampLon(lon), alt: clampAlt(defaultAlt) });
        toast(t("rallyPlaced"), "success");
        return;
      }
      // SAR pattern datum/start point placement — explicit "datum" tool only, so a
      // plain select-mode click can never silently move the datum. The armed
      // pattern is read from the authoritative planner mode (set when datum was
      // armed), not from a sibling store. Sticky: stays in datum mode so the point
      // can be re-placed; switch tools to exit.
      if (activeTool === "datum") {
        const mode = usePlannerStore.getState().mode;
        const pattern = mode.kind === "datum" ? datumPatternFor(mode) : null;
        const patternStore = usePatternStore.getState();
        if (pattern === "expandingSquare") {
          patternStore.updateSarExpandingSquareConfig({ center: [clampLat(lat), clampLon(lon)] });
          toast(t("datumSet"), "success");
        } else if (pattern === "sectorSearch") {
          patternStore.updateSarSectorSearchConfig({ center: [clampLat(lat), clampLon(lon)] });
          toast(t("datumSet"), "success");
        } else if (pattern === "parallelTrack") {
          patternStore.updateSarParallelTrackConfig({ startPoint: [clampLat(lat), clampLon(lon)] });
          toast(t("startPointSet"), "success");
        } else {
          // survey / orbit / corridor / structureScan take their area from a
          // drawn boundary, not a datum click — don't claim no pattern is armed.
          toast(t("areaByDrawing"), "info");
        }
        return;
      }
      // The ROI tool attaches an action to the last navigation waypoint rather
      // than creating a top-level ROI row, which is not a navigation command.
      if (activeTool === "roi") {
        if (!activePlanId) { toast(t("openPlanFirst"), "info"); return; }
        const attached = attachRoiAction(waypoints, clampLat(lat), clampLon(lon), clampAlt(defaultAlt));
        toast(
          attached ? t("roiAttached") : t("roiNeedsWaypoint"),
          attached ? "success" : "info",
        );
        return;
      }
      const command = TOOL_COMMAND_MAP[activeTool];
      if (!command) return;
      if (!activePlanId) { toast(t("openPlanFirst"), "info"); return; }
      const wp: Waypoint = {
        id: randomId(), lat: clampLat(lat), lon: clampLon(lon),
        alt: command === "LAND" ? 0 : clampAlt(defaultAlt), speed: defaultSpeed, command,
        frame: placementFrame(),
        ...acceptRadiusDefault(command, defaultAcceptRadius),
      };
      addWaypoint(wp);
    },
    [activePlanId, activeTool, addWaypoint, addRallyPoint, defaultAlt, defaultSpeed, defaultAcceptRadius, toast, t, waypoints]
  );

  const handleMapRightClick = useCallback(
    (lat: number, lon: number, x: number, y: number) => {
      setContextMenu({
        x, y, lat, lon,
        items: [
          { id: "add-wp", label: "Add Waypoint" },
          { id: "add-takeoff", label: "Add Takeoff" },
          { id: "add-land", label: "Add Land" },
          { id: "add-roi", label: "Set ROI" },
          { id: "div1", label: "", divider: true },
          { id: "add-rally", label: "Add Rally Point Here" },
          { id: "div2", label: "", divider: true },
          { id: "center", label: "Center Map Here" },
        ],
      });
    },
    [setContextMenu]
  );

  const handleWaypointRightClick = useCallback(
    (id: string, x: number, y: number) => {
      setContextMenu({
        x, y, waypointId: id,
        items: [
          { id: "edit", label: "Edit" },
          { id: "insert-before", label: "Insert Before" },
          { id: "insert-after", label: "Insert After" },
          { id: "div1", label: "", divider: true },
          { id: "delete-wp", label: "Delete", danger: true },
        ],
      });
    },
    [setContextMenu]
  );

  // Insert a fresh waypoint just before or after an existing one, nudged off
  // it so the two markers don't stack. It flies at the altitude of the
  // waypoint it follows. Shared by the map context menu and the waypoint
  // inspector's menu.
  const handleInsertRelative = useCallback(
    (waypointId: string, where: "before" | "after") => {
      const idx = waypoints.findIndex((w) => w.id === waypointId);
      if (idx === -1) return;
      const ref = waypoints[idx];
      const prev = where === "after" ? ref : waypoints[idx - 1] ?? ref;
      const newWp = waypointForInsert(prev, { lat: ref.lat + 0.0005, lon: ref.lon + 0.0005 });
      insertWaypoint(newWp, where === "before" ? idx : idx + 1);
    },
    [waypoints, insertWaypoint]
  );

  const handleContextAction = useCallback(
    (actionId: string) => {
      if (!contextMenu) return;
      const { lat, lon, waypointId } = contextMenu;
      const addActions = ["add-wp", "add-takeoff", "add-land", "add-roi", "add-rally"];
      if (addActions.includes(actionId) && !activePlanId) {
        toast(t("openPlanFirst"), "info");
        setContextMenu(null);
        return;
      }
      const makeWp = (cmd: Waypoint["command"]): Waypoint => ({
        id: randomId(), lat: clampLat(lat ?? 0), lon: clampLon(lon ?? 0),
        alt: cmd === "LAND" ? 0 : clampAlt(defaultAlt), command: cmd, frame: placementFrame(),
        ...acceptRadiusDefault(cmd ?? "WAYPOINT", defaultAcceptRadius),
      });
      switch (actionId) {
        case "add-wp": addWaypoint(makeWp("WAYPOINT")); break;
        case "add-takeoff": addWaypoint(makeWp("TAKEOFF")); break;
        case "add-land": addWaypoint(makeWp("LAND")); break;
        // ROI is an action, not a navigation command: it attaches to the last
        // waypoint instead of becoming a top-level row the FC mis-sequences.
        case "add-roi": {
          const attached = attachRoiAction(
            waypoints, clampLat(lat ?? 0), clampLon(lon ?? 0), clampAlt(defaultAlt),
          );
          if (!attached) toast(t("roiNeedsWaypoint"), "info");
          break;
        }
        case "add-rally":
          addRallyPoint({ id: randomId(), lat: clampLat(lat ?? 0), lon: clampLon(lon ?? 0), alt: clampAlt(defaultAlt) });
          break;
        case "center":
          if (lat !== undefined && lon !== undefined) {
            usePlannerStore.getState().requestPan(lat, lon);
          }
          break;
        case "edit":
          if (waypointId) setSelectedWaypoint(waypointId);
          break;
        case "insert-before":
          if (waypointId) handleInsertRelative(waypointId, "before");
          break;
        case "insert-after":
          if (waypointId) handleInsertRelative(waypointId, "after");
          break;
        case "delete-wp": if (waypointId) removeWaypoint(waypointId); break;
      }
      setContextMenu(null);
    },
    [contextMenu, activePlanId, addWaypoint, addRallyPoint, removeWaypoint, defaultAlt, defaultAcceptRadius, waypoints, setSelectedWaypoint, toast, t, setContextMenu, handleInsertRelative]
  );

  const handleWaypointClick = useCallback((id: string, additive?: boolean, range?: boolean) => {
    const planner = usePlannerStore.getState();
    if (range && planner.selectedWaypointId) {
      planner.selectRange(planner.selectedWaypointId, id, waypoints.map((w) => w.id));
    } else if (additive) {
      // The first Ctrl/Cmd+click after a plain selection carries that waypoint
      // into the batch, so two clicks make a two-waypoint batch.
      const anchor = planner.selectedWaypointId;
      if (planner.selectedWaypointIds.length === 0 && anchor && anchor !== id) {
        planner.toggleWaypointSelection(anchor);
      }
      planner.toggleWaypointSelection(id);
    } else {
      // A plain click starts over: one waypoint, no batch.
      planner.clearMultiSelection();
      setSelectedWaypoint(id);
    }
  }, [setSelectedWaypoint, waypoints]);

  // Insert a waypoint between waypoint index-1 and index, at the midpoint of
  // its two neighbours and at the preceding waypoint's altitude and frame (an
  // average of two altitudes in different frames means nothing). Past the last
  // row (no following waypoint) the new point is nudged off the previous one.
  const handleInsertAt = useCallback((index: number) => {
    const wps = useMissionStore.getState().waypoints;
    const before = wps[index - 1];
    if (!before) return;
    const after = wps[index];
    const at = after
      ? { lat: (before.lat + after.lat) / 2, lon: (before.lon + after.lon) / 2 }
      : { lat: before.lat + 0.0005, lon: before.lon + 0.0005 };
    useMissionStore.getState().insertWaypoint(waypointForInsert(before, at), index);
  }, []);

  const handleWaypointDragEnd = useCallback(
    (id: string, lat: number, lon: number) => {
      // The store drops the moved waypoint's old terrain sample; the terrain
      // sync resamples the new position.
      setWaypoints(waypoints.map((wp) => wp.id === id ? { ...wp, lat: clampLat(lat), lon: clampLon(lon) } : wp));
    },
    [waypoints, setWaypoints]
  );

  const handleClearAll = useCallback(() => {
    // "Clear All" clears every planner domain, so open the confirm whenever ANY
    // of them has content — not only when there are waypoints.
    const geo = useGeofenceStore.getState();
    const draw = useDrawingStore.getState();
    const hasContent =
      waypoints.length > 0 ||
      useRallyStore.getState().points.length > 0 ||
      draw.polygons.length > 0 || draw.circles.length > 0 || draw.measureLine !== null ||
      geo.enabled || geo.polygonPoints.length > 0 || geo.circleCenter !== null || geo.zones.length > 0;
    if (hasContent) setShowClearConfirm(true);
  }, [waypoints.length, setShowClearConfirm]);

  const confirmClear = useCallback(() => {
    // One undo step restores every domain "Clear All" wiped.
    withPlannerHistory(() => {
      clearMission();
      useRallyStore.getState().clearPoints();
      useDrawingStore.getState().clearAll();
      useGeofenceStore.getState().clearFence();
    });
    void clearAutoSave();
    usePlannerStore.getState().clearSelection();
    // The plan stays open under its name and vehicle: clearing empties its
    // contents (undoable above), it does not close or rename it.
    setShowClearConfirm(false);
    toast(t("missionCleared"), "info");
  }, [clearMission, toast, t, setShowClearConfirm]);

  const handleReverseWaypoints = useCallback(() => {
    if (waypoints.length < 2) return;
    setWaypoints(reverseWaypoints(waypoints));
    toast(t("waypointsReversed"), "info");
  }, [waypoints, setWaypoints, toast, t]);

  /**
   * Upload the mission to the selected vehicle; with `resumeFromIndex`, upload
   * the resume mission that picks the plan up at that waypoint instead. Toasts
   * the outcome and returns it for callers that report it inline.
   */
  const handleUpload = useCallback(async (resumeFromIndex?: number): Promise<{ success: boolean; message: string }> => {
    let override: Waypoint[] | undefined;
    if (resumeFromIndex !== undefined) {
      const profile = useMissionStore.getState().vehicleProfile
        ?? profileFromVehicleInfo(selectedDroneProtocol()?.getVehicleInfo())
        ?? DEFAULT_PLAN_PROFILE;
      try {
        override = buildResumeMission(waypoints, resumeFromIndex, {
          takeoffAltM: defaultAlt, speedMps: defaultSpeed, vehicleClass: profile.vehicleClass,
        });
      } catch (err) {
        const message = t("uploadFailedReason", { reason: err instanceof Error ? err.message : String(err) });
        toast(message, "error");
        return { success: false, message };
      }
    }
    const ok = await uploadMission(undefined, override ? { waypoints: override } : undefined);
    if (ok) {
      const message = resumeFromIndex !== undefined
        ? t("resumeUploaded", { n: resumeFromIndex + 1 })
        : t("missionUploaded");
      toast(message, "success");
      return { success: true, message };
    }
    const { uploadError, uploadErrorCode } = useMissionStore.getState();
    const reason = describeUploadFailure(uploadErrorCode, uploadError);
    const message = reason ? t("uploadFailedReason", { reason }) : t("uploadFailed");
    toast(message, "error");
    return { success: false, message };
  }, [uploadMission, waypoints, defaultAlt, defaultSpeed, toast, t, describeUploadFailure]);

  const handleDrawingComplete = useDrawingComplete(toast);
  const { handlePatternApply, applyPatternConfirmed } = usePatternApply({
    activePlanId, waypointCount: waypoints.length, setWaypoints, setShowPatternApplyConfirm, toast,
  });

  const handleAddManualWaypoint = useCallback(() => {
    if (!activePlanId) { toast(t("openPlanFirst"), "info"); return; }
    const lastWp = waypoints[waypoints.length - 1];
    // With no waypoint to follow, the new one goes where the operator is looking.
    const [centerLat, centerLon] = usePlannerStore.getState().mapCenter;
    const wp: Waypoint = {
      id: randomId(), lat: clampLat(lastWp ? lastWp.lat + 0.001 : centerLat),
      lon: clampLon(lastWp ? lastWp.lon + 0.001 : centerLon), alt: clampAlt(defaultAlt), command: "WAYPOINT",
      frame: placementFrame(),
      ...acceptRadiusDefault("WAYPOINT", defaultAcceptRadius),
    };
    addWaypoint(wp);
  }, [activePlanId, waypoints, addWaypoint, defaultAlt, defaultAcceptRadius, toast, t]);

  return {
    handleMapClick, handleMapRightClick, handleWaypointRightClick,
    handleContextAction, handleWaypointClick, handleWaypointDragEnd, handleInsertAt, handleInsertRelative,
    handleClearAll, confirmClear, handleReverseWaypoints, handleUpload,
    handleDrawingComplete, handlePatternApply, applyPatternConfirmed, handleAddManualWaypoint,
  };
}
