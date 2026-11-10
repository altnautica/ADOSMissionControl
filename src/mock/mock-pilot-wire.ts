/**
 * @module mock/mock-pilot-wire
 * @description The demo pilot's wire state and the pins a demo scenario
 * lays over it. The wire is the agent's `pilot` kind in snake_case; pins
 * (`window.__adosDemoPilot.pin`) override any field of it, which is how the
 * states the demo vehicle does not fly on its own reach the cockpit: an FC
 * failsafe (`fc_failsafe`, `failsafe_cause`) and a tuning step (`owner:
 * "tuning"`, `setup_step`).
 * @license GPL-3.0-only
 */

export type Json = Record<string, unknown>;

/** The pilot actions the demo pilot accepts from a surface, as the agent
 * advertises them. */
export const DEMO_SURFACE_OPS: readonly string[] = ["goto"];

/** The demo pilot's wire state (snake_case, as the agent sends it). The
 * agent omits `fc_failsafe` while it is false; a pin sets it. */
export function demoPilotWire(over: Json = {}): Json {
  return {
    owner: "idle",
    owner_label: null,
    skill: null,
    vehicle_class: "multirotor",
    control_mode: "ados",
    profile: "normal",
    avoid: "brake",
    fc_mode: 4,
    fc_mode_name: "GUIDED",
    armed: false,
    landed: true,
    input_src: null,
    input_age_ms: null,
    hold_reason: null,
    avoid_state: "clear",
    min_clearance_m: null,
    goal_ned: null,
    plan_ned: [],
    setpoint_ned: null,
    readiness: [
      { id: "fc_profile", ok: true, severity: "block", msg: "FC failsafe parameters match the ADOS profile" },
      { id: "position", ok: true, severity: "block", msg: "Position estimate available" },
      { id: "agl", ok: true, severity: "warn", msg: "Rangefinder AGL available" },
    ],
    link_loss_in_s: null,
    mission: null,
    input_session: null,
    gate: null,
    sequence: null,
    banner: null,
    rth_countdown_s: null,
    surface_ops: [],
    setup_step: null,
    failsafe_cause: null,
    ...over,
  };
}

/** Pins a demo scenario lays over the live wire state. */
export class PilotPins {
  private fields: Json = {};

  /** Replace every pin; `{}` clears. */
  set(fields: Json): void {
    this.fields = { ...fields };
  }

  clear(): void {
    this.fields = {};
  }

  /** The wire state with the pins on top. */
  over(wire: Json): Json {
    return { ...wire, ...this.fields };
  }

  /** The FC flies a failsafe of its own (pinned, or on the wire). */
  failsafe(wire: Json): boolean {
    return this.over(wire).fc_failsafe === true;
  }

  /** The FC left its failsafe (an operator's mode change or a disarm). */
  clearFailsafe(): void {
    delete this.fields.fc_failsafe;
    delete this.fields.failsafe_cause;
  }
}
