/**
 * @module agent/agent-mode-names
 * @description The name the agent's `mode` command takes for each GCS flight
 * mode, per firmware. The agent encodes a mode name through the table of the
 * firmware it identified on the vehicle and answers 400 for a name outside it,
 * so a surface that routes a mode change through the agent offers a preset
 * only when that table has an equivalent, and sends the table's name for it.
 *
 * Mirrors the agent's tables: the ArduPilot Copter / Plane / Rover tables in
 * `crates/ados-protocol/src/flight_modes.rs` (whose names are the GCS names)
 * and the PX4 table in `crates/ados-control/src/routes/command.rs` (which
 * names modes the way PX4 does: ALTCTL, POSCTL, STABILIZED, FOLLOW_TARGET).
 * The agent has no table for ArduSub, Betaflight or iNav, so it sets no mode
 * on them.
 *
 * @license GPL-3.0-only
 */

import type { FirmwareType, UnifiedFlightMode } from "@/lib/protocol/types";

type ArduPilotModeFirmware =
  | "ardupilot-copter"
  | "ardupilot-plane"
  | "ardupilot-rover";

const ARDUPILOT_MODE_NAMES: Record<
  ArduPilotModeFirmware,
  ReadonlySet<string>
> = {
  "ardupilot-copter": new Set([
    "STABILIZE", "ACRO", "ALT_HOLD", "AUTO", "GUIDED", "LOITER", "RTL",
    "CIRCLE", "LAND", "DRIFT", "SPORT", "FLIP", "AUTOTUNE", "POSHOLD", "BRAKE",
    "THROW", "AVOID_ADSB", "GUIDED_NOGPS", "SMART_RTL", "FLOWHOLD", "FOLLOW",
    "ZIGZAG", "SYSTEMID", "AUTOROTATE", "AUTO_RTL",
  ]),
  "ardupilot-plane": new Set([
    "MANUAL", "CIRCLE", "STABILIZE", "TRAINING", "ACRO", "FBWA", "FBWB",
    "CRUISE", "AUTOTUNE", "AUTO", "RTL", "LOITER", "AVOID_ADSB", "GUIDED",
    "QSTABILIZE", "QHOVER", "QLOITER", "QLAND", "QRTL", "QAUTOTUNE", "QACRO",
    "THERMAL", "LOITER_ALT_QLAND",
  ]),
  "ardupilot-rover": new Set([
    "MANUAL", "ACRO", "STEERING", "HOLD", "LOITER", "FOLLOW", "SIMPLE", "AUTO",
    "RTL", "SMART_RTL", "GUIDED",
  ]),
};

/**
 * The agent's PX4 name for each GCS mode the PX4 handler offers. The GCS
 * names PX4's modes the ArduPilot way (ALT_HOLD for ALTCTL, POSHOLD for
 * POSCTL); the agent takes PX4's own names. ORBIT (a POSCTL sub-mode) and
 * VTOL_TAKEOFF have no entry in the agent's table, so they are absent.
 */
const PX4_AGENT_MODE_NAME: Partial<Record<UnifiedFlightMode, string>> = {
  MANUAL: "MANUAL",
  STABILIZE: "STABILIZED",
  ALT_HOLD: "ALTCTL",
  POSHOLD: "POSCTL",
  ACRO: "ACRO",
  OFFBOARD: "OFFBOARD",
  RATTITUDE: "RATTITUDE",
  READY: "READY",
  TAKEOFF: "TAKEOFF",
  LOITER: "LOITER",
  AUTO: "AUTO",
  MISSION: "MISSION",
  RTL: "RTL",
  LAND: "LAND",
  FOLLOW_ME: "FOLLOW_TARGET",
  PRECLAND: "PRECLAND",
};

const ARDUPILOT_TABLES = Object.values(ARDUPILOT_MODE_NAMES);

/** The firmware an agent-routed mode change is encoded for. `"ardupilot"` is
 * the family with no identified airframe. */
export type AgentModeFirmware = FirmwareType | "ardupilot";

/**
 * The name the agent's `mode` command takes for `mode` on a vehicle running
 * `firmware`, or null when the agent's table has no equivalent. For
 * `"ardupilot"` a name passes only when every ArduPilot table carries it,
 * since the agent may resolve the vehicle to any of them.
 */
export function agentModeName(
  firmware: AgentModeFirmware,
  mode: UnifiedFlightMode,
): string | null {
  if (firmware === "px4") return PX4_AGENT_MODE_NAME[mode] ?? null;
  if (firmware === "ardupilot") {
    return ARDUPILOT_TABLES.every((table) => table.has(mode)) ? mode : null;
  }
  if (firmware in ARDUPILOT_MODE_NAMES) {
    return ARDUPILOT_MODE_NAMES[firmware as ArduPilotModeFirmware].has(mode)
      ? mode
      : null;
  }
  return null;
}
