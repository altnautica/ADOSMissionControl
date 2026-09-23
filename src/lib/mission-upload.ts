/**
 * @module mission-upload
 * @description The one expansion the planner uploads, and what follows from it:
 * the content hash an upload receipt records and the mapping from a mission
 * `seq` reported by the FC back to a planner waypoint.
 *
 * Upload, receipt comparison and progress tracking all go through here, so the
 * hash and the seq mapping always describe the exact items that were sent.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { MissionItem } from "@/lib/protocol/types";
import { usePlannerStore } from "@/stores/planner-store";
import { contentHash } from "@/stores/upload-receipts-store";
import {
  expandToItems,
  expandedItemOwners,
  type HomeSlot,
} from "@/lib/mission/mission-expand";

/**
 * Expand the planner waypoints into the wire items an upload sends. Each
 * waypoint without its own frame takes the planner's default frame, and each
 * without its own speed flies the planner's default speed.
 */
export function missionUploadItems(
  waypoints: readonly Waypoint[],
  reserveHomeSlot?: HomeSlot,
): MissionItem[] {
  const { defaultFrame, defaultSpeed } = usePlannerStore.getState();
  return expandToItems(waypoints, { defaultFrame, defaultSpeed, reserveHomeSlot });
}

/**
 * Hash of the mission content an upload would send, without the ArduPilot
 * home slot. The home position moves (the FC resets it on arming), but it is
 * not part of the plan, so it must not make an unchanged mission look edited.
 */
export function missionContentHash(waypoints: readonly Waypoint[]): string {
  return contentHash(missionUploadItems(waypoints));
}

/**
 * Planner waypoint index for a mission `seq` reported by the FC, or `null` when
 * the seq is the home slot or lies outside the mission. An action item maps to
 * the waypoint it is attached to.
 *
 * @param homeSlot the upload reserved ArduPilot's seq 0 for home.
 */
export function missionSeqToWaypointIndex(
  waypoints: readonly Waypoint[],
  seq: number,
  homeSlot: boolean,
): number | null {
  const itemIndex = homeSlot ? seq - 1 : seq;
  if (!Number.isInteger(itemIndex) || itemIndex < 0) return null;
  const { defaultSpeed } = usePlannerStore.getState();
  return expandedItemOwners(waypoints, { defaultSpeed })[itemIndex] ?? null;
}
