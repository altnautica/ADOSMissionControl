/**
 * @module hud/pilot-fields
 * @description Smaller parts of the `pilot` kind, parsed apart from
 * `cockpit-frames.ts`: the horizontal speed cap (`speed_cap`, and its value
 * as the flight-state chip prints it), the FC's STATUSTEXT lines, and the
 * stick limits and stick command (`profile_limits`, `stick`).
 *
 * Dependency-free on purpose: Mission Control copies this file byte for byte.
 *
 * @license GPL-3.0-only
 */

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** The pilot's horizontal speed cap: why, and the limit in m/s. */
export interface SpeedCap {
  reason: string;
  vHMps: number;
}

/** `speed_cap` from the pilot frame, or null when absent or malformed. */
export function parseSpeedCap(raw: unknown): SpeedCap | null {
  const o = obj(raw);
  const reason = o ? str(o.reason) : null;
  const vHMps = o ? num(o.v_h_mps) : null;
  return reason !== null && vHMps !== null ? { reason, vHMps } : null;
}

/** The cap in m/s with at most one decimal (1.5 → "1.5", 2 → "2"), the same
 *  on every surface. */
export function speedCapText(vHMps: number): string {
  return String(Math.round(vHMps * 10) / 10);
}

/** The pilot does not trust the horizontal position: `reason` is
 *  `flow_disagrees`, `extnav_lost` or `extnav_degraded`; `detail` Navigation's
 *  own reason when it named one. */
export interface PositionUnverified {
  reason: string;
  detail: string | null;
  flowMps: number | null;
  estimateMps: number | null;
}

/** `position_unverified` from the pilot frame, or null when absent (an older
 *  agent) or malformed. */
export function parsePositionUnverified(raw: unknown): PositionUnverified | null {
  const o = obj(raw);
  const reason = o ? str(o.reason) : null;
  if (!o || reason === null) return null;
  return { reason, detail: str(o.detail), flowMps: num(o.flow_mps), estimateMps: num(o.estimate_mps) };
}

/** One FC STATUSTEXT line; severity is MAVLink's (0 emergency … 4 warning). */
export interface FcStatusText {
  severity: number;
  text: string;
  ageMs: number;
}

/** `statustext` from the pilot frame: at most 8 well-formed lines. */
export function parseStatusText(raw: unknown): FcStatusText[] {
  if (!Array.isArray(raw)) return [];
  const out: FcStatusText[] = [];
  for (const r of raw.slice(0, 8)) {
    const o = obj(r);
    const text = o ? str(o.text) : null;
    const severity = o ? num(o.severity) : null;
    if (!o || text === null || severity === null) continue;
    out.push({ severity, text, ageMs: num(o.age_ms) ?? 0 });
  }
  return out;
}

/** The limits the operator's sticks fly at now (`profile_limits`): the
 *  profile's row held under the flight controller's and the vehicle's limits
 *  and the place's caps. Speeds m/s, yaw °/s, accelerations m/s² (yaw °/s²),
 *  jerk m/s³, expo 0..1, the stop distance from full speed and the obstacle
 *  margin in metres (0 from an agent that does not send it). */
export interface ProfileLimits {
  profile: "cine" | "normal" | "sport";
  vHMps: number;
  vUpMps: number;
  vDownMps: number;
  yawDps: number;
  aAccMps2: number;
  aBrkMps2: number;
  jerkMps3: number;
  aVMps2: number;
  yawDps2: number;
  expoH: number;
  expoV: number;
  expoYaw: number;
  stopM: number;
  marginM: number;
}

const PROFILES = ["cine", "normal", "sport"] as const;

/** `profile_limits` from the pilot frame, or null when absent (an older
 *  agent) or malformed. */
export function parseProfileLimits(raw: unknown): ProfileLimits | null {
  const o = obj(raw);
  if (!o) return null;
  const profile = PROFILES.find((p) => p === o.profile);
  const vHMps = num(o.v_h_mps);
  if (!profile || vHMps === null) return null;
  const n = (k: string) => num(o[k]) ?? 0;
  return {
    profile,
    vHMps,
    vUpMps: n("v_up_mps"),
    vDownMps: n("v_down_mps"),
    yawDps: n("yaw_dps"),
    aAccMps2: n("a_acc_mps2"),
    aBrkMps2: n("a_brk_mps2"),
    jerkMps3: n("jerk_mps3"),
    aVMps2: n("a_v_mps2"),
    yawDps2: n("yaw_dps2"),
    expoH: n("expo_h"),
    expoV: n("expo_v"),
    expoYaw: n("expo_yaw"),
    stopM: n("stop_m"),
    marginM: n("margin_m"),
  };
}

/** The operator's sticks on the pilot's latest stick tick (`stick`): the
 *  asked velocity after the centre threshold and expo, the shaped reference
 *  sent (north-east, vertical + up, yaw rate + clockwise), whether it brakes
 *  to a hold, and the age and sequence of the stick frame flown. */
export interface StickCommand {
  askNeMps: [number, number];
  askVzMps: number;
  askYawDps: number;
  vNeMps: [number, number];
  aNeMps2: [number, number];
  vzMps: number;
  yawRateDps: number;
  braking: boolean;
  inputAgeMs: number;
  inputSeq: number;
}

function pair(v: unknown): [number, number] {
  return Array.isArray(v) ? [num(v[0]) ?? 0, num(v[1]) ?? 0] : [0, 0];
}

/** `stick` from the pilot frame, or null while the sticks do not fly (or
 *  from an older agent). */
export function parseStickCommand(raw: unknown): StickCommand | null {
  const o = obj(raw);
  const inputAgeMs = o ? num(o.input_age_ms) : null;
  if (!o || inputAgeMs === null) return null;
  return {
    askNeMps: pair(o.ask_ne_mps),
    askVzMps: num(o.ask_vz_mps) ?? 0,
    askYawDps: num(o.ask_yaw_dps) ?? 0,
    vNeMps: pair(o.v_ne_mps),
    aNeMps2: pair(o.a_ne_mps2),
    vzMps: num(o.vz_mps) ?? 0,
    yawRateDps: num(o.yaw_rate_dps) ?? 0,
    braking: o.braking === true,
    inputAgeMs,
    inputSeq: num(o.input_seq) ?? 0,
  };
}
