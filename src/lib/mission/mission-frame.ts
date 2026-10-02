/**
 * @module mission/mission-frame
 * @description Explicit altitude frames on stored waypoints.
 *
 * A waypoint with no `frame` takes the planner's default frame when it is
 * uploaded, and that default is a global preference the operator can change at
 * any time. A frameless waypoint saved under one default therefore changes
 * meaning (above home vs above sea level) when the preference changes. Every
 * waypoint the planner creates carries its frame, and stored plans written
 * before that are stamped once, on migration, with the default that was in
 * effect when they were saved.
 *
 * Leaf module (storage + types only) so the persisted stores can import it
 * without joining their import cycles.
 *
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Waypoint } from "@/lib/types/mission";
import { indexedDBStorage } from "@/lib/storage";
import { DEFAULT_ALTITUDE_FRAME } from "./altitude-frame";

/** Persistence key of the planner preferences (default alt, speed, frame). */
export const PLANNER_STORE_KEY = "altcmd:planner-store";

const FRAMES: Record<AltitudeFrame, true> = { relative: true, absolute: true, terrain: true };

/** Whether a value is one of the three altitude frames. */
export function isAltitudeFrame(value: unknown): value is AltitudeFrame {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FRAMES, value);
}

/** Give every frameless waypoint `frame`; waypoints with a frame are kept as they are. */
export function stampWaypointFrames(waypoints: readonly Waypoint[], frame: AltitudeFrame): Waypoint[] {
  return waypoints.map((wp) => (wp.frame ? wp : { ...wp, frame }));
}

/**
 * The default frame stored in the planner preferences, read straight from
 * storage. Store migrations run while the stores hydrate, before the planner
 * store is guaranteed to have loaded, so they read the stored value rather
 * than the in-memory one. Falls back to the built-in default (`relative`),
 * which is also what an upload used when no preference had been stored.
 */
export async function readPersistedDefaultFrame(): Promise<AltitudeFrame> {
  try {
    const raw = await indexedDBStorage.storage().getItem(PLANNER_STORE_KEY);
    if (typeof raw !== "string") return DEFAULT_ALTITUDE_FRAME;
    const parsed = JSON.parse(raw) as { state?: { defaultFrame?: unknown } };
    const frame = parsed.state?.defaultFrame;
    return isAltitudeFrame(frame) ? frame : DEFAULT_ALTITUDE_FRAME;
  } catch {
    return DEFAULT_ALTITUDE_FRAME;
  }
}
