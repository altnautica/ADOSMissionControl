/**
 * @module upload-guard
 * @description The one refusal every mission, fence and rally upload applies
 * while the target vehicle is armed and flying its mission: a new mission
 * replaces the one being flown under the vehicle, which keeps flying whatever
 * lands at its current index, and a fence or rally swap changes the limits
 * and the return point mid-flight. The state is read per target from its
 * mission state, never from flight-mode names, so a second drone's reading
 * never decides for the target. An unknown state does not block.
 * @license GPL-3.0-only
 */

import { readMissionStatus } from "@/lib/mission/use-mission-status";
import type { MissionStatus } from "@/lib/mission/mission-state";

/** The refusal text every upload path returns while the target flies its mission. */
export const MISSION_ACTIVE_REFUSAL = "Pause the mission before uploading";

/** The vehicle is flying its mission: the mission state is `active`. */
export function isFlyingMission(status: MissionStatus | null | undefined): boolean {
  return status?.state === "active";
}

/** MISSION_ACTIVE_REFUSAL when `droneId` is flying its mission, else null. An unknown state passes. */
export function flyingMissionRefusal(droneId: string | null | undefined): string | null {
  if (!droneId) return null;
  return isFlyingMission(readMissionStatus(droneId)) ? MISSION_ACTIVE_REFUSAL : null;
}
