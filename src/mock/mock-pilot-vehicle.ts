/**
 * @module mock/mock-pilot-vehicle
 * @description How the demo pilot drives and mirrors the demo vehicle (its
 * `MockProtocol` flight state), with the real pilot's refusals. AUTO is the
 * FC flying its mission (owner `mission_fc`), RTL and LAND are the FC's own
 * modes (owner `fc_mode`), disarmed is `idle`. Land lands and disarms, RTH
 * flies home, Pause in a mission puts the FC in a hold mode (mission paused)
 * and Resume puts it back in AUTO, Fly Here (`goto`) takes the vehicle to a
 * point in GUIDED, Kill stops the motors. During an FC failsafe Pause and Fly
 * Here are refused: the operator changes mode first.
 * @license GPL-3.0-only
 */

import type { UnifiedFlightMode } from "@/lib/protocol/types";
import type { MockProtocol } from "./mock-protocol";
import type { Json } from "./mock-pilot-wire";

/** Height a demo takeoff climbs to when the action names none, metres. */
const TAKEOFF_ALT_M = 10;

/** Hand-to-FC choices: the copter custom mode (for a vehicle the demo does not
 * fly) and the FC mode it sets. */
const FC_MODE: Record<string, [number, UnifiedFlightMode]> = {
  loiter: [5, "LOITER"],
  poshold: [16, "POSHOLD"],
  althold: [2, "ALT_HOLD"],
};

/** FC modes that fly the vehicle home or down on their own. */
const FC_RETURN_MODES: Partial<Record<UnifiedFlightMode, true>> = { RTL: true, SMART_RTL: true, LAND: true };

/** FC hold modes: leaving a mission into one of them pauses it. */
const FC_HOLD_MODES: Partial<Record<UnifiedFlightMode, true>> = { LOITER: true, POSHOLD: true, BRAKE: true, ALT_HOLD: true };

/** How a mission the vehicle left stands: paused in a hold mode, or loaded
 * while the pilot flies (a stick takeover); either resumes in AUTO. */
type HeldMission = "paused" | "loaded";

/** A Fly Here target from the action's args, or null when one is missing. */
function gotoTarget(args: Json): { lat: number; lon: number; alt: number } | null {
  const { lat, lon, alt_m: alt } = args;
  if (typeof lat !== "number" || typeof lon !== "number" || typeof alt !== "number") return null;
  return { lat, lon, alt };
}

export class DemoVehicleDriver {
  /** The demo vehicle's mode and arm state at the last mirror. */
  private lastMode: UnifiedFlightMode | null = null;
  private lastArmed: boolean | null = null;
  private held: HeldMission | null = null;

  reset(): void {
    this.lastMode = null;
    this.lastArmed = null;
    this.held = null;
  }

  /**
   * An action on the demo vehicle; the refusal code, or null when accepted.
   * `seen` is the state the operator sees (the wire with its pins).
   */
  act(p: MockProtocol, wire: Json, seen: Json, verb: string, args: Json): string | null {
    const f = p.flight;
    switch (verb) {
      case "arm":
        f.arm();
        return null;
      case "disarm":
        if (!f.armed) return "disarmed";
        if (f.airborne) return "not_landed";
        f.disarm();
        return null;
      case "kill":
        void p.killSwitch(true);
        return null;
      case "takeoff":
      case "launch": {
        if (!f.armed) f.arm();
        const alt = typeof args.alt_m === "number" ? args.alt_m : TAKEOFF_ALT_M;
        if (!f.airborne) f.takeoff(alt);
        wire.owner = "pilot";
        return null;
      }
      case "take_control":
        if (!f.armed) return "disarmed";
        f.setMode("GUIDED");
        wire.owner = "pilot";
        return null;
      case "pause":
        if (!f.armed) return "disarmed";
        if (!f.airborne) return "landed";
        if (seen.fc_failsafe === true) return "failsafe";
        if (f.mode === "AUTO") {
          // The FC holds where it is: the mission pauses, the FC flies.
          f.setMode("LOITER");
          wire.owner = "fc_mode";
          return null;
        }
        // Anything else: the pilot takes the vehicle and brakes to a hold.
        f.setMode("GUIDED");
        wire.owner = "pilot";
        return null;
      case "resume":
        if (!f.armed) return "disarmed";
        if (this.held === null) return "nothing_paused";
        f.setMode("AUTO");
        return null;
      case "goto": {
        if (!f.airborne) return "landed";
        if (!f.armed) return "disarmed";
        if (seen.owner === "tuning") return "tuning";
        if (seen.control_mode !== "ados") return "control_mode";
        if (seen.fc_failsafe === true) return "failsafe";
        const target = gotoTarget(args);
        if (!target) return "bad_args";
        f.setMode("GUIDED");
        void p.guidedGoto(target.lat, target.lon, target.alt);
        wire.owner = "pilot";
        return null;
      }
      case "hand_to_fc": {
        const [, mode] = FC_MODE[String(args.mode ?? "loiter")] ?? FC_MODE.loiter;
        f.setMode(mode);
        wire.owner = "fc_mode";
        return null;
      }
      case "rth":
        if (!f.armed) return "disarmed";
        if (!f.airborne) return "landed";
        void p.returnToLaunch();
        return null;
      case "land":
        if (!f.armed) return "disarmed";
        // The demo touches down at once; the FC then disarms on the ground.
        f.land();
        f.disarm();
        return null;
    }
    return "unknown_action";
  }

  /** An action with no demo vehicle behind it: only the owner moves. */
  wireOnly(wire: Json, seen: Json, verb: string, args: Json): string | null {
    switch (verb) {
      case "pause":
      case "goto":
        if (seen.fc_failsafe === true) return "failsafe";
        wire.owner = "pilot";
        wire.fc_mode = 4;
        wire.fc_mode_name = "GUIDED";
        break;
      case "take_control":
      case "takeoff":
      case "launch":
      case "resume":
        wire.owner = "pilot";
        wire.fc_mode = 4;
        wire.fc_mode_name = "GUIDED";
        break;
      case "hand_to_fc": {
        const [num, label] = FC_MODE[String(args.mode ?? "loiter")] ?? FC_MODE.loiter;
        wire.owner = "fc_mode";
        wire.fc_mode = num;
        wire.fc_mode_name = label;
        break;
      }
      case "rth":
        wire.owner = "fc_mode";
        wire.fc_mode = 6;
        wire.fc_mode_name = "RTL";
        break;
      case "land":
        wire.owner = "fc_mode";
        wire.fc_mode = 9;
        wire.fc_mode_name = "LAND";
        break;
    }
    return null;
  }

  /**
   * Bring the wire state in line with the demo vehicle. True when the FC
   * changed mode or disarmed since the last mirror, which ends any FC
   * failsafe, as on the real pilot.
   */
  mirror(p: MockProtocol, w: Json): boolean {
    const f = p.flight;
    const prev = this.lastMode;
    const wasArmed = this.lastArmed;
    this.lastMode = f.mode;
    this.lastArmed = f.armed;
    w.armed = f.armed;
    w.landed = !f.airborne;
    w.fc_mode = customMode(p, f.mode);
    w.fc_mode_name = f.mode;

    if (!f.armed || !f.airborne) {
      this.held = null;
    } else if (f.mode === "AUTO" || FC_RETURN_MODES[f.mode]) {
      this.held = null;
    } else if (prev === "AUTO") {
      // Leaving the mission: a hold mode pauses it, any other mode (the
      // pilot's GUIDED) leaves it loaded to resume.
      this.held = FC_HOLD_MODES[f.mode] ? "paused" : "loaded";
    }

    if (!f.armed) {
      w.owner = "idle";
    } else if (f.mode === "AUTO") {
      w.owner = "mission_fc";
    } else if (FC_RETURN_MODES[f.mode]) {
      w.owner = "fc_mode";
    } else if (w.owner === "idle" || w.owner === "mission_fc") {
      // The FC flies a mode of its own (the mode bar, an RC switch).
      w.owner = "fc_mode";
    }

    const progress = f.missionProgress;
    const state = f.armed && f.mode === "AUTO" ? "active" : this.held;
    w.mission =
      state && progress
        ? { state, seq: progress.seq, total: progress.total, landing_seq: false }
        : null;

    return (prev !== null && prev !== f.mode) || (wasArmed === true && !f.armed);
  }
}

/** The FC's numeric custom mode for `mode`, or null when its firmware has none. */
function customMode(p: MockProtocol, mode: UnifiedFlightMode): number | null {
  try {
    return p.getFirmwareHandler().encodeFlightMode(mode).customMode;
  } catch {
    return null;
  }
}
