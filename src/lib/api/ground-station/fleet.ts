/**
 * @module lib/api/ground-station/fleet
 * @description Fleet-wide ground-station operations that address the swarm
 * rather than one drone.
 *
 * @license GPL-3.0-only
 */

import { GroundStationApiError, gsRequest, type RequestContext } from "./request";

/** One registered slot's row in the hero route's reply. */
export interface FleetHeroSlot {
  slot: number;
  device_id: string;
  profile: "hero" | "thumbnail";
  ok: boolean;
  /** Still being called when the reply was cut; neither success nor failure. */
  pending: boolean;
  error: string | null;
}

/**
 * The hero route's body: the selected hero plus one row per registered slot.
 * The UI does not read the aircraft's state from it: the beacon's `hero` bit
 * is what the board renders, so a demotion that silently failed shows up as
 * two heroes on the table rather than as an assumption this reply talked us
 * into.
 */
export interface FleetHeroResult {
  hero: string;
  slots: FleetHeroSlot[];
}

/**
 * Promote one drone to the full-rate video profile and demote every other
 * registered slot to thumbnails. Exclusive by construction on the agent side —
 * selecting a new hero demotes the previous one in the same operation.
 *
 * A 207 carries per-slot outcomes for drones that would not demote; it is not
 * an error, because a drone stuck on `hero` is an airtime problem and must
 * never block the new hero's promotion. A 502 means the hero's own promotion
 * failed and rejects like any other error.
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

/**
 * Why a hero selection failed, for the operator: the hero row's own error when
 * the agent answered with its per-slot body, otherwise the error's message.
 */
export function fleetHeroFailureReason(err: unknown): string {
  if (err instanceof GroundStationApiError) {
    try {
      const body = JSON.parse(err.body) as Partial<FleetHeroResult>;
      const row = body.slots?.find((s) => s.device_id === body.hero);
      if (row && !row.ok && row.error) return row.error;
    } catch {
      // Not the per-slot body; fall through to the message.
    }
  }
  return err instanceof Error ? err.message : String(err);
}
