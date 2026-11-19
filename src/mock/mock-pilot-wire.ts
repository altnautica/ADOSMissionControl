/**
 * @module mock/mock-pilot-wire
 * @description The demo pilot's wire state and the pins a demo scenario
 * lays over it. The wire is the agent's `pilot` kind in snake_case; pins
 * (`window.__adosDemoPilot.pin`) override any field of it, which is how the
 * states the demo vehicle does not fly on its own reach the cockpit: an FC
 * failsafe (`fc_failsafe`, `failsafe_cause`), a tuning step (`owner:
 * "tuning"`, `setup_step`) and an aborted setup air run (`setup_abort`, a
 * `setup.blocker.aborted_<reason>` key). One pin is not a pilot field: `follow`
 * holds the demo follow-me report in one phase, with any `follow.state` fields
 * (snake_case) laid over it, e.g. `pin({ armed: true, landed: false, owner:
 * "skill", skill: { plugin_id: "com.altnautica.follow-me", skill_id:
 * "follow-me", label: "Follow-Me" }, follow: { phase:
 * "holding-await-operator", hold_reason: "search-exhausted" } })`.
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
      DEMO_BALANCE_LEARNING,
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
    setup_abort: null,
    place_class: "open",
    ...over,
  };
}

/** The airframe balance row before the first steady hover has taught it. */
export const DEMO_BALANCE_LEARNING: Json = {
  id: "airframe_balance",
  ok: true,
  severity: "warn",
  msg: "Balance: learning. Learned after the first steady hover.",
};

/** The airframe balance row once a steady take-off has learned the trim. */
export const DEMO_BALANCE_LEARNED: Json = { ...DEMO_BALANCE_LEARNING, msg: "Balance: OK." };

/** The stop distance from `v` m/s, as the agent's
 * `ProfileLimits::stop_distance_m`: `v²/(2·a_brk) + v·a_brk/(2·jerk) + v·0.15 s`. */
function stopM(v: number, aBrk: number, jerk: number): number {
  return Math.round(((v * v) / (2 * aBrk) + (v * aBrk) / (2 * jerk) + v * 0.15) * 100) / 100;
}

function limitsRow(profile: string, r: Json): Json {
  const stop = stopM(r.v_h_mps as number, r.a_brk_mps2 as number, r.jerk_mps3 as number);
  return { profile, ...r, stop_m: stop, margin_m: 1.5 };
}

/** The multirotor stick rows the agent flies per profile (snake_case
 * `profile_limits`), from ados-pilot's `multirotor_sticks`. */
export const DEMO_STICK_LIMITS: Record<"cine" | "normal" | "sport", Json> = {
  cine: limitsRow("cine", {
    v_h_mps: 3, v_up_mps: 1.5, v_down_mps: 1, yaw_dps: 30, a_acc_mps2: 1, a_brk_mps2: 2, jerk_mps3: 4,
    a_v_mps2: 0.6, yaw_dps2: 60, expo_h: 0.25, expo_v: 0.3, expo_yaw: 0.2,
  }),
  normal: limitsRow("normal", {
    v_h_mps: 7, v_up_mps: 2.5, v_down_mps: 1.5, yaw_dps: 90, a_acc_mps2: 2, a_brk_mps2: 2.5, jerk_mps3: 5,
    a_v_mps2: 1, yaw_dps2: 180, expo_h: 0.25, expo_v: 0.3, expo_yaw: 0.2,
  }),
  sport: limitsRow("sport", {
    v_h_mps: 10, v_up_mps: 3, v_down_mps: 2, yaw_dps: 150, a_acc_mps2: 2.5, a_brk_mps2: 2.5, jerk_mps3: 5,
    a_v_mps2: 1, yaw_dps2: 270, expo_h: 0.4, expo_v: 0.4, expo_yaw: 0.3,
  }),
};

/** The pin for an airframe flying the standard take-off (steady take-off
 * off): its readiness row says so and a launch runs no supervised lift-off.
 * The demo default is steady take-off on. */
export const DEMO_STANDARD_TAKEOFF_PIN: Json = {
  readiness: [
    ...(demoPilotWire().readiness as Json[]),
    { id: "supervised_liftoff", ok: false, severity: "warn", msg: "Standard take-off. Steady take-off is off." },
  ],
};

/**
 * The pin for a position the pilot cannot trust: the optical flow measures
 * 5.3 m/s while the estimate reads 0.3 m/s (the estimate froze while the
 * drone flew on), and the pilot holds for it. The demo Navigation echoes it
 * as a degraded pose (`mock-nav`). From the console:
 * `__adosDemoPilot.pin({ hold_reason: "position-unverified", position_unverified:
 * { reason: "flow_disagrees", flow_mps: 5.3, estimate_mps: 0.3 } })`.
 */
export const DEMO_POSITION_UNVERIFIED_PIN: Json = {
  hold_reason: "position-unverified",
  position_unverified: { reason: "flow_disagrees", flow_mps: 5.3, estimate_mps: 0.3 },
};

/**
 * The pin for a low-battery return the estimate of the way home asked for
 * above the 30 % floor: 1 km out, the return needs 52 % and the battery
 * reads 48 %, so the pilot counts down to its SmartRTL. From the console:
 * `__adosDemoPilot.pin(DEMO_LOW_BATTERY_ENERGY_PIN)` while flying.
 */
export const DEMO_LOW_BATTERY_ENERGY_PIN: Json = {
  low_battery_action: "rth",
  rth_countdown_s: 8,
  battery_reserve: { need_pct: 52, basis: "energy", return_s: 248 },
  banner: {
    text_key: "pilot.banner.low_battery_rth_energy",
    args: { pct: 48, need_pct: 52, in_s: 10 },
    until_ms: null,
  },
};

/** The wire's `position_unverified` reason and detail. */
export interface DemoPositionUnverified {
  reason: string;
  detail: string | null;
}

/** `position_unverified` on a wire state, or null when absent. */
export function pinnedPositionUnverified(wire: Json): DemoPositionUnverified | null {
  const pu = wire.position_unverified as Json | null | undefined;
  if (!pu || typeof pu.reason !== "string") return null;
  return { reason: pu.reason, detail: typeof pu.detail === "string" ? pu.detail : null };
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

  /** The pinned `follow` report, or null. */
  follow(): Json | null {
    const f = this.fields.follow;
    return typeof f === "object" && f !== null && !Array.isArray(f) ? (f as Json) : null;
  }

  /** Lay `fields` over the current pins. */
  patch(fields: Json): void {
    this.fields = { ...this.fields, ...fields };
  }

  /** Drop the named pins (the pilot or the operator set those fields itself). */
  drop(...keys: string[]): void {
    for (const k of keys) delete this.fields[k];
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

  /** The pilot left a pinned mission stall (a skip, a return or a landing):
   *  the stall, its hold reason and its banner go with it. */
  clearStall(): void {
    delete this.fields.mission_stall;
    delete this.fields.hold_reason;
    delete this.fields.banner;
  }

  /** The operator set the open class: the confined route check and the speed
   *  cap near the clearance limit go with the confined class. */
  clearConfined(): void {
    delete this.fields.route_check;
    const cap = this.fields.speed_cap;
    if (typeof cap === "object" && cap !== null && (cap as Json).reason === "confined-near") delete this.fields.speed_cap;
  }
}
