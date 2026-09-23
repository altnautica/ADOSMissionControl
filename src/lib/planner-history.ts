/**
 * @module planner-history
 * @description Single coordinated undo/redo timeline for the whole mission
 * planner.
 *
 * The planner edits several independent domains — mission waypoints, the
 * geofence, rally points, plan-attached points of interest, and free-drawn
 * shapes (polygons / circles / measure lines). Each lived in its own store and
 * only waypoints had undo. The operator's mental model is "undo my last action",
 * not "undo my last action in this one panel", so this module unifies them into
 * ONE timeline of combined snapshots.
 *
 * Every operator-facing mutation in the planner domain stores runs inside
 * `withPlannerHistory`, which records the combined state of all domains as a
 * single timeline entry before the change lands; a compound edit wrapped in
 * one outer `withPlannerHistory` is one entry however many stores it touches.
 * A single Ctrl+Z restores the whole snapshot, so undo never surprises the
 * operator by reverting a change in a domain they were not looking at — it
 * reverts exactly the previous combined state regardless of which domain the
 * last edit touched.
 *
 * Timeline semantics (before-snapshot, matching the legacy waypoint stack):
 *   record()  → push the CURRENT combined state onto the undo timeline, clear redo
 *   undo()    → push current onto redo, pop the last undo entry, restore it
 *   redo()    → push current onto undo, pop the last redo entry, restore it
 *
 * Cycle-free wiring: this module imports the three leaf domain stores directly
 * (they import nothing back). The mission-waypoint half is supplied via a
 * registered adapter so mission-store can import this module without this module
 * importing mission-store back.
 *
 * @license GPL-3.0-only
 */

import { useGeofenceStore } from "@/stores/geofence-store";
import type { GeofenceSnapshot } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import type { RallySnapshot } from "@/stores/rally-store";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import type { PoiSnapshot } from "@/stores/plan-poi-store";
import { useDrawingStore } from "@/stores/drawing-store";
import type { DrawingSnapshot } from "@/stores/drawing-store";
import {
  registerWaypointAdapter,
  snapshotWaypoints,
  restoreWaypoints,
  registerHistoryRecorder,
  withPlannerHistory,
} from "./planner-history-adapter";
import type { WaypointSnapshot, WaypointAdapter } from "./planner-history-adapter";

// The waypoint-adapter holder lives in a dependency-free leaf module so an
// import cycle re-entering through the leaf-store graph can never register it
// before it is initialised (a temporal-dead-zone hazard if it lived here, since
// the store imports above pull in the drone-manager graph). Re-export the public
// surface so existing consumers keep importing it from this module.
export { registerWaypointAdapter, withPlannerHistory };
export type { WaypointSnapshot, WaypointAdapter };

/** Maximum coordinated-history depth (matches the legacy waypoint stack). */
export const MAX_PLANNER_HISTORY = 50;

/** A single point on the unified timeline: a combined snapshot of all domains. */
interface CombinedSnapshot {
  waypoints: WaypointSnapshot;
  geofence: GeofenceSnapshot;
  rally: RallySnapshot;
  poi: PoiSnapshot;
  drawing: DrawingSnapshot;
}

// The single timeline. These are module-level (transient, never persisted): a
// page reload starts a fresh history, which is the correct behaviour for an
// undo stack.
let undoStack: CombinedSnapshot[] = [];
let redoStack: CombinedSnapshot[] = [];

// Listeners notified after every timeline change. Lets a store mirror the
// undo/redo depth so existing ``canUndo`` / ``canRedo`` UI affordances stay
// reactive without exposing the snapshot contents.
type HistoryListener = (depths: { undo: number; redo: number }) => void;
const listeners = new Set<HistoryListener>();

/**
 * Subscribe to timeline-depth changes. Returns an unsubscribe function. The
 * listener fires immediately with the current depths so a subscriber can
 * initialise its mirror.
 */
export function subscribeHistory(listener: HistoryListener): () => void {
  listeners.add(listener);
  listener({ undo: undoStack.length, redo: redoStack.length });
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  const depths = { undo: undoStack.length, redo: redoStack.length };
  for (const listener of listeners) listener(depths);
}

/** Capture the current combined state across every planner domain. */
function captureCombined(): CombinedSnapshot {
  return {
    waypoints: snapshotWaypoints(),
    geofence: useGeofenceStore.getState().snapshot(),
    rally: useRallyStore.getState().snapshot(),
    poi: usePlanPoiStore.getState().snapshot(),
    drawing: useDrawingStore.getState().snapshot(),
  };
}

/** Restore a previously captured combined state into every planner domain. */
function applyCombined(snap: CombinedSnapshot): void {
  restoreWaypoints(snap.waypoints);
  useGeofenceStore.getState().restore(snap.geofence);
  useRallyStore.getState().restore(snap.rally);
  usePlanPoiStore.getState().restore(snap.poi);
  useDrawingStore.getState().restore(snap.drawing);
}

/**
 * Record the current combined state as one undo point (the before-snapshot
 * model the legacy waypoint stack used). Clears the redo timeline because a new
 * edit branches off the current state. Reached only through
 * `withPlannerHistory`, which decides whether an edit starts a new step.
 */
function recordHistory(): void {
  undoStack = [...undoStack, captureCombined()];
  if (undoStack.length > MAX_PLANNER_HISTORY) undoStack.shift();
  redoStack = [];
  notify();
}
registerHistoryRecorder(recordHistory);

/**
 * Undo the last recorded planner change across all domains. The current combined
 * state is pushed onto the redo timeline first so redo can replay it. No-op when
 * the undo timeline is empty.
 */
export function undoHistory(): void {
  if (undoStack.length === 0) return;
  const stack = [...undoStack];
  const prev = stack.pop();
  if (!prev) return;
  const current = captureCombined();
  undoStack = stack;
  redoStack = [...redoStack, current].slice(-MAX_PLANNER_HISTORY);
  applyCombined(prev);
  notify();
}

/**
 * Redo the last undone planner change across all domains. No-op when the redo
 * timeline is empty.
 */
export function redoHistory(): void {
  if (redoStack.length === 0) return;
  const stack = [...redoStack];
  const next = stack.pop();
  if (!next) return;
  const current = captureCombined();
  redoStack = stack;
  undoStack = [...undoStack, current].slice(-MAX_PLANNER_HISTORY);
  applyCombined(next);
  notify();
}

/** Drop the entire timeline (e.g. on mission clear / new mission). */
export function clearHistory(): void {
  undoStack = [];
  redoStack = [];
  notify();
}

/** True when there is at least one undo point. */
export function canUndo(): boolean {
  return undoStack.length > 0;
}

/** True when there is at least one redo point. */
export function canRedo(): boolean {
  return redoStack.length > 0;
}

/** Current undo timeline depth. Exposed for tests / UI affordances. */
export function undoDepth(): number {
  return undoStack.length;
}

/** Current redo timeline depth. Exposed for tests / UI affordances. */
export function redoDepth(): number {
  return redoStack.length;
}
