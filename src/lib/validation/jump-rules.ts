/**
 * @module validation/jump-rules
 * @description DO_JUMP checks. A jump must resolve to a real waypoint (by id,
 * so it survives reorder), must not loop forever with no way out, and must be
 * a jump the target autopilot actually takes:
 *  - PX4 only jumps back to an earlier item, and rejects a negative repeat
 *    count other than -1 (forever).
 *  - ArduPilot treats only -1 as forever; -2 or lower is never taken. It
 *    tracks a limited number of jumps (15 on most boards); later ones are
 *    never taken.
 *
 * @license GPL-3.0-only
 */

import type { PlanVehicleProfile, Waypoint } from "@/lib/types";
import type { ValidationIssue } from "./issue-types";

/** DO_JUMPs ArduPilot tracks on most boards; larger boards track 100. */
export const ARDUPILOT_TRACKED_JUMPS = 15;

const TERMINAL: Record<string, true> = { LAND: true, VTOL_LAND: true, RTL: true };

/** Every DO_JUMP issue in the mission. */
export function jumpIssues(
  waypoints: readonly Waypoint[],
  profile?: PlanVehicleProfile,
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const indexById = new Map(waypoints.map((w, i) => [w.id, i]));
  // Anything after the first terminal command never executes, so a jump into
  // that region targets dead mission.
  const firstTerminalIndex = waypoints.findIndex((w) => TERMINAL[w.command ?? "WAYPOINT"]);
  const px4 = profile?.autopilot === "px4";
  const ardupilot = profile?.autopilot === "ardupilot";
  let jumpCount = 0;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const at = { waypointIndex: i, waypointId: wp.id };
    for (const action of wp.actions ?? []) {
      if (action.command !== "DO_JUMP") continue;
      jumpCount++;
      if (ardupilot && jumpCount === ARDUPILOT_TRACKED_JUMPS + 1) {
        warnings.push({
          severity: "advisory",
          code: "JUMP_TRACKING_LIMIT",
          message: `WP${i + 1}: more than ${ARDUPILOT_TRACKED_JUMPS} DO_JUMPs. Only the first ${ARDUPILOT_TRACKED_JUMPS} jumps are tracked on most boards`,
          text: { key: "wpMoreThanDOJUMPsOnly", params: { v0: i + 1, v1: ARDUPILOT_TRACKED_JUMPS, v2: ARDUPILOT_TRACKED_JUMPS } },
          ...at,
        });
      }

      const targetIndex = action.jumpTargetId === undefined ? undefined : indexById.get(action.jumpTargetId);
      if (targetIndex === undefined) {
        errors.push({
          severity: "blocking",
          code: "INVALID_JUMP_TARGET",
          message: `WP${i + 1}: DO_JUMP has no valid target waypoint`,
          text: { key: "wpDOJUMPHasNoValid", params: { v0: i + 1 } },
          ...at,
        });
        continue;
      }
      const repeat = action.param2 ?? 0;
      // The jump item sits after its waypoint on the wire, so a jump to the
      // same waypoint goes backwards.
      const backwards = targetIndex <= i;

      if (px4 && !backwards) {
        errors.push({
          severity: "blocking",
          code: "JUMP_FORWARD_UNSUPPORTED",
          message: `WP${i + 1}: DO_JUMP targets WP${targetIndex + 1}, but PX4 only jumps back to an earlier item`,
          text: { key: "wpDOJUMPTargetsWPBut", params: { v0: i + 1, v1: targetIndex + 1 } },
          ...at,
        });
      }

      if (repeat < -1 && ardupilot) {
        errors.push({
          severity: "blocking",
          code: "JUMP_NEVER_TAKEN",
          message: `WP${i + 1}: DO_JUMP repeat ${repeat}: ArduPilot never takes this jump (only -1 repeats forever)`,
          text: { key: "wpDOJUMPRepeatArduPilotNever", params: { v0: i + 1, v1: repeat } },
          ...at,
        });
      } else if (repeat < -1 && px4) {
        errors.push({
          severity: "blocking",
          code: "JUMP_REPEAT_INVALID",
          message: `WP${i + 1}: DO_JUMP repeat ${repeat}: PX4 rejects a negative repeat other than -1`,
          text: { key: "wpDOJUMPRepeatPX4Rejects", params: { v0: i + 1, v1: repeat } },
          ...at,
        });
      } else if (backwards && repeat < 0) {
        // A backwards jump that repeats forever never leaves the loop, so the
        // mission has no end and the vehicle never lands.
        errors.push({
          severity: "blocking",
          code: "JUMP_LOOP_NO_EXIT",
          message: `WP${i + 1}: DO_JUMP loops back to WP${targetIndex + 1} forever — the mission never reaches a landing`,
          text: { key: "wpDOJUMPLoopsBackTo", params: { v0: i + 1, v1: targetIndex + 1 } },
          ...at,
        });
      } else if (repeat < 0) {
        warnings.push({
          severity: "advisory",
          code: "JUMP_REPEAT_FOREVER",
          message: `WP${i + 1}: DO_JUMP repeat count is negative — the jump repeats forever`,
          text: { key: "wpDOJUMPRepeatCountIs", params: { v0: i + 1 } },
          ...at,
        });
      }

      if (firstTerminalIndex !== -1 && targetIndex > firstTerminalIndex) {
        warnings.push({
          severity: "advisory",
          code: "UNREACHABLE_JUMP_TARGET",
          message: `WP${i + 1}: DO_JUMP targets WP${targetIndex + 1}, which sits after the mission ends at WP${firstTerminalIndex + 1}`,
          text: { key: "wpDOJUMPTargetsWPWhich", params: { v0: i + 1, v1: targetIndex + 1, v2: firstTerminalIndex + 1 } },
          ...at,
        });
      }
    }
  }
  return { errors, warnings };
}
