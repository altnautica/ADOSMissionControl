/**
 * @module planner-history-adapter
 * @description The mission-waypoint snapshot/restore adapter holder and the
 * history-scope entry point (`withPlannerHistory`) for the coordinated planner
 * undo timeline.
 *
 * This is a deliberately dependency-free leaf module. The coordinated history
 * (`planner-history.ts`) imports the three leaf domain stores, two of which pull
 * in the drone-manager graph; mission-store registers its adapter at module
 * init. If the holder lived in `planner-history.ts`, an import cycle re-entering
 * through that store graph could call `registerWaypointAdapter` while
 * `planner-history.ts` was still evaluating its own imports, before its
 * module-level `let` had initialised — a temporal-dead-zone throw. Isolating the
 * holder in a module that imports nothing means it is fully initialised before
 * any other module can reach it, so registration during a cycle is always safe.
 * The planner domain stores import `withPlannerHistory` from here for the same
 * reason: the timeline imports them, so they cannot import the timeline back.
 *
 * @license GPL-3.0-only
 */

/**
 * Opaque per-domain waypoint snapshot. The shape is owned by mission-store and
 * passed through the history untouched, so the history never has to know the
 * Waypoint type (which would create an import cycle).
 */
export type WaypointSnapshot = unknown;

/**
 * Adapter the mission-waypoint half registers so the coordinated history can
 * snapshot / restore waypoints without importing mission-store.
 */
export interface WaypointAdapter {
  snapshot: () => WaypointSnapshot;
  restore: (snap: WaypointSnapshot) => void;
}

let waypointAdapter: WaypointAdapter | null = null;

/**
 * Register the mission-waypoint snapshot/restore adapter. Called once by
 * mission-store at module init. Until registered, the waypoint half is a no-op
 * so the other three domains still undo/redo correctly (and tests that touch
 * only one domain do not have to wire mission-store).
 */
export function registerWaypointAdapter(adapter: WaypointAdapter): void {
  waypointAdapter = adapter;
}

/** Snapshot the registered waypoint domain, or `null` when none is registered. */
export function snapshotWaypoints(): WaypointSnapshot {
  return waypointAdapter ? waypointAdapter.snapshot() : null;
}

/** Restore the registered waypoint domain (no-op when none is registered). */
export function restoreWaypoints(snap: WaypointSnapshot): void {
  if (waypointAdapter) waypointAdapter.restore(snap);
}

let historyRecorder: (() => void) | null = null;
let scopeDepth = 0;

/**
 * Register the function that captures one undo point (the coordinated
 * timeline's `recordHistory`). Called once by planner-history at module init.
 */
export function registerHistoryRecorder(recorder: () => void): void {
  historyRecorder = recorder;
}

/**
 * Run one operator-facing planner edit as a single undo step. The combined
 * planner state is recorded before `edit` runs; nested calls (a compound edit
 * whose parts are themselves recorded store mutations) add no further points,
 * so the whole compound undoes in one step. Every operator-facing mutation in
 * the planner domain stores goes through this, so no caller has to remember
 * to record.
 */
export function withPlannerHistory<T>(edit: () => T): T {
  if (scopeDepth === 0) historyRecorder?.();
  scopeDepth += 1;
  try {
    return edit();
  } finally {
    scopeDepth -= 1;
  }
}
