/**
 * Arm / airborne / mode state of one demo vehicle, and the arm, disarm, land,
 * takeoff and mode commands that change it.
 *
 * The rules follow what the real MAVLink path gets back from a flight
 * controller, so demo mode exercises the same outcomes:
 * - A disarm while airborne is refused (MAV_RESULT_FAILED). ArduPilot only
 *   accepts a GCS disarm in flight when it carries the force magic number, and
 *   Mission Control never sends one. Land first, then disarm.
 * - Land touches the demo vehicle down at once (the demo does not model the
 *   descent) and leaves it armed in LAND; the operator disarms it.
 * - An RTL ends in the FC's own touchdown at home and its automatic disarm.
 * - Flight termination (kill) stops the motors: disarmed, on the ground.
 * - Takeoff needs an armed vehicle; arming on the ground does not take off.
 *
 * Every change is pushed at once through `onChange` as a heartbeat, so the
 * vehicle's registry arm state and the selected-drone store follow a command
 * without waiting for the 1 Hz heartbeat tick.
 *
 * @license GPL-3.0-only
 */

import type { CommandResult, UnifiedFlightMode } from "@/lib/protocol/types";

/** MAV_RESULT_FAILED: the command was valid but cannot run in this state. */
const MAV_RESULT_FAILED = 4;

export interface MockFlightSnapshot {
  armed: boolean;
  airborne: boolean;
  mode: UnifiedFlightMode;
}

type Say = (severity: number, text: string) => void;

const ok = (message: string): CommandResult => ({ success: true, resultCode: 0, message });

export class MockFlightState implements MockFlightSnapshot {
  armed = false;
  airborne = false;
  mode: UnifiedFlightMode = "STABILIZE";
  /** MISSION_CURRENT seq and mission item count (home excluded) of the loop
   * the vehicle flies; kept current by the demo engine, null when it flies none. */
  missionProgress: { seq: number; total: number } | null = null;

  constructor(
    private readonly onChange: (state: MockFlightSnapshot) => void,
    private readonly say: Say,
  ) {}

  /** Set the starting state (a demo drone that boots mid-flight). Emits nothing. */
  init(state: Partial<MockFlightSnapshot>): void {
    if (state.armed !== undefined) this.armed = state.armed;
    if (state.airborne !== undefined) this.airborne = state.airborne;
    if (state.mode !== undefined) this.mode = state.mode;
  }

  arm(): CommandResult {
    if (this.armed) return ok("Already armed");
    this.armed = true;
    this.say(6, "Arming motors");
    this.changed();
    return ok("Armed");
  }

  disarm(): CommandResult {
    if (!this.armed) return ok("Already disarmed");
    if (this.airborne) {
      this.say(4, "Disarm refused: vehicle is flying");
      return { success: false, resultCode: MAV_RESULT_FAILED, message: "Disarm refused: the vehicle is flying. Land first." };
    }
    this.armed = false;
    this.say(6, "Disarming motors");
    this.changed();
    return ok("Disarmed");
  }

  land(): CommandResult {
    if (!this.airborne) return ok("Already landed");
    this.airborne = false;
    this.mode = "LAND";
    this.say(6, "Landing");
    this.say(6, "Land complete");
    this.changed();
    return ok("Landed");
  }

  /** The FC's own landing at the end of an RTL: touch down, then the
   * automatic disarm a landed vehicle does. */
  touchDown(): void {
    if (!this.airborne && !this.armed) return;
    this.airborne = false;
    this.armed = false;
    this.say(6, "Land complete");
    this.say(6, "Disarming motors");
    this.changed();
  }

  /** Flight termination: motors stop at once, airborne or not. */
  kill(): void {
    if (!this.armed && !this.airborne) return;
    this.armed = false;
    this.airborne = false;
    this.changed();
  }

  takeoff(altM: number): CommandResult {
    if (!this.armed) return { success: false, resultCode: MAV_RESULT_FAILED, message: "Takeoff refused: arm the vehicle first" };
    this.airborne = true;
    this.mode = "GUIDED";
    this.say(6, `Taking off to ${altM}m`);
    this.changed();
    return ok(`Takeoff ${altM}m`);
  }

  setMode(mode: UnifiedFlightMode): CommandResult {
    this.mode = mode;
    this.say(6, `Mode change to ${mode}`);
    this.changed();
    return ok(`Mode: ${mode}`);
  }

  private changed(): void {
    this.onChange({ armed: this.armed, airborne: this.airborne, mode: this.mode });
  }
}
