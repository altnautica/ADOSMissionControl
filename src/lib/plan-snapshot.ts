/**
 * @module plan-snapshot
 * @description The canonical dirty-tracking snapshot of a saved plan.
 *
 * A plan is its path PLUS its fence, rally points and POIs. The snapshot used
 * to be `JSON.stringify(waypoints)` alone, so editing a geofence left the plan
 * looking clean: no dirty dot, no library autosave, and "Download from drone"
 * offered no save prompt before discarding the edit. Every writer of
 * `savedSnapshot` and the dirty comparison itself go through this one function
 * so they cannot drift apart.
 *
 * Leaf module by design (types only), so the plan store, the workspace loader
 * and the planner's dirty effect can all import it without a cycle.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { PlanExtras } from "@/stores/plan-library-store";

/**
 * Serialize a plan for dirty comparison. Absent domains are written as `null`
 * (not omitted) so "had a fence, deleted it" differs from "never had one".
 */
export function planSnapshotString(
  waypoints: readonly Waypoint[],
  extras?: PlanExtras,
): string {
  return JSON.stringify({
    waypoints,
    geofence: extras?.geofence ?? null,
    rally: extras?.rally ?? null,
    pois: extras?.pois ?? null,
  });
}
