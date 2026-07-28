/**
 * @module lib/api/ground-station/fleet
 * @description Fleet-wide ground-station operations that address the swarm
 * rather than one drone.
 *
 * @license GPL-3.0-only
 */

import { gsRequest, type RequestContext } from "./request";

/** One slot's outcome when a hero change fanned demotions across the fleet. */
export interface FleetHeroOutcome {
  device_id: string;
  ok: boolean;
  error?: string | null;
}

/**
 * The hero route's body. Every field is optional because the UI does not read
 * the aircraft's state from this response: the beacon's `hero` bit is what the
 * board renders, so a demotion that silently failed shows up as two heroes on
 * the table rather than as an assumption this reply talked us into.
 */
export interface FleetHeroResult {
  hero_device_id?: string | null;
  outcomes?: FleetHeroOutcome[];
}

/**
 * Promote one drone to the full-rate video profile and demote every other
 * registered slot to thumbnails. Exclusive by construction on the agent side —
 * selecting a new hero demotes the previous one in the same operation.
 *
 * A 207 carries per-slot outcomes for drones that would not demote; it is not
 * an error, because a drone stuck on `hero` is an airtime problem and must
 * never block the new hero's promotion.
 */
export function setFleetHero(
  ctx: RequestContext,
  deviceId: string,
): Promise<FleetHeroResult> {
  return gsRequest<FleetHeroResult>(ctx, "/api/v1/ground-station/fleet/hero", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId }),
  });
}
