/**
 * @module hud/cockpit-mission
 * @description The mission parts of the cockpit v2 `pilot` kind, parsed apart
 * from `cockpit-frames.ts`: the agent-computed mission state with its target
 * and coverage gaps, the mission stall, and the confined-place profile's place
 * class and route check. `cockpit-frames.ts` re-exports everything here.
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
function oneOf<T extends string>(v: unknown, values: readonly T[]): T | null {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;
}
function pt3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  const c = num(v[2]);
  return a === null || b === null || c === null ? null : [a, b, c];
}
function nums(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((s): s is number => num(s) !== null) : [];
}

// ── mission state ────────────────────────────────────────────────────

export const MISSION_STATES = ["none", "loaded", "active", "paused", "complete", "returning"] as const;
export type MissionStateName = (typeof MISSION_STATES)[number];

/** The mission item the FC flies now (`mission.target`). `ned` is the item
 *  position in the FC's local NED frame, null for an item without one. */
export interface MissionTarget {
  seq: number;
  cmd: number | null;
  ned: [number, number, number] | null;
  radiusM: number | null;
}

/** One skipped mission item (`mission.gaps[]`): a coverage gap to re-fly. */
export interface MissionGap {
  seq: number;
  /** `stall_timeout` (skipped after the countdown) or `stall_operator`. */
  reason: string | null;
  atMs: number | null;
}

/** The agent-computed mission state. `seq`/`total` follow MISSION_CURRENT. */
export interface MissionState {
  state: MissionStateName | null;
  seq: number | null;
  total: number | null;
  itemReached: number | null;
  id: number | null;
  source: "mission_state" | "fallback" | null;
  ageMs: number | null;
  landingSeq: boolean;
  uploadsSeen: number | null;
  target: MissionTarget | null;
  /** Items skipped this mission, oldest first; empty while none. */
  gaps: MissionGap[];
}

function parseMissionTarget(raw: unknown): MissionTarget | null {
  const t = obj(raw);
  const seq = t ? num(t.seq) : null;
  if (!t || seq === null) return null;
  return { seq, cmd: num(t.cmd), ned: pt3(t.ned), radiusM: num(t.radius_m) };
}

function parseMissionGaps(raw: unknown): MissionGap[] {
  if (!Array.isArray(raw)) return [];
  const out: MissionGap[] = [];
  for (const g of raw) {
    const o = obj(g);
    const seq = o ? num(o.seq) : null;
    if (!o || seq === null) continue;
    out.push({ seq, reason: str(o.reason), atMs: num(o.at_ms) });
  }
  return out;
}

/** Accepts the full `state.v5` object (`state`, `seq`, `total`, `landing_seq`)
 *  and the short `pilot` form (`current_seq`, `total`). */
export function parseMission(raw: unknown): MissionState | null {
  const m = obj(raw);
  if (!m) return null;
  return {
    state: oneOf(m.state, MISSION_STATES),
    seq: num(m.seq) ?? num(m.current_seq),
    total: num(m.total),
    itemReached: num(m.item_reached),
    id: num(m.id),
    source: oneOf(m.source, ["mission_state", "fallback"] as const),
    ageMs: num(m.age_ms),
    landingSeq: m.landing_seq === true,
    uploadsSeen: num(m.uploads_seen),
    target: parseMissionTarget(m.target),
    gaps: parseMissionGaps(m.gaps),
  };
}

/** A mission or return that stopped making progress (`mission_stall`): the
 *  vehicle holds and the operator chooses. Persistent while it lasts. */
export interface MissionStall {
  kind: "mission" | "return";
  /** The stalled mission item; null for a return. */
  seq: number | null;
  /** The item's label as the plan shows it; null for a return. */
  wpLabel: string | null;
  /** Wall-clock epoch ms the stall was raised. */
  sinceMs: number | null;
  /** Seconds to the automatic action (the skip for a mission, the landing
   *  for a return); null: no countdown, the vehicle holds for the operator. */
  skipInS: number | null;
  /** The no-progress window that raised it, seconds. */
  windowS: number | null;
}

export function parseMissionStall(raw: unknown): MissionStall | null {
  const s = obj(raw);
  const kind = s ? oneOf(s.kind, ["mission", "return"] as const) : null;
  if (!s || !kind) return null;
  return {
    kind,
    seq: num(s.seq),
    wpLabel: str(s.wp_label),
    sinceMs: num(s.since_ms),
    skipInS: num(s.skip_in_s),
    windowS: num(s.window_s),
  };
}

// ── place class and route check (the confined-place profile) ───────────────────

/** The operator's place class: `confined` flies tighter to walls, slower
 *  near the limit, and checks the mission route before and during flight. */
export const PLACE_CLASSES = ["open", "confined"] as const;
export type PlaceClass = (typeof PLACE_CLASSES)[number];

/** The tightest checked point of the route. */
export interface RoutePinch {
  /** The leg runs from mission item `fromSeq` to `toSeq`. */
  fromSeq: number;
  toSeq: number;
  /** Local NED of the point, metres. */
  ned: [number, number, number];
  clearanceM: number;
  requiredM: number;
}

/** The pilot's check of the loaded mission against its occupancy grid,
 *  present only in the confined class with a mission loaded. */
export interface RouteCheck {
  state: "feasible" | "unverified" | "infeasible";
  /** Clearance the route must keep: the margin plus the pose uncertainty. */
  requiredM: number | null;
  marginM: number | null;
  /** Live pose uncertainty; null while unknown. */
  sigmaM: number | null;
  pinch: RoutePinch | null;
  /** `to_seq` of the legs that cross cells not yet observed. */
  unverifiedLegs: number[];
  /** Mission items the check cannot place (no position): the legs to and
   *  from them are not checked. */
  unchecked: number[];
  /** The mission is longer than the route the check holds: its end is not
   *  checked. */
  truncated: boolean;
}

function parseRoutePinch(raw: unknown): RoutePinch | null {
  const p = obj(raw);
  if (!p) return null;
  const fromSeq = num(p.from_seq);
  const toSeq = num(p.to_seq);
  const ned = pt3(p.ned);
  const clearanceM = num(p.clearance_m);
  const requiredM = num(p.required_m);
  if (fromSeq === null || toSeq === null || !ned || clearanceM === null || requiredM === null) return null;
  return { fromSeq, toSeq, ned, clearanceM, requiredM };
}

export function parseRouteCheck(raw: unknown): RouteCheck | null {
  const r = obj(raw);
  const state = r ? oneOf(r.state, ["feasible", "unverified", "infeasible"] as const) : null;
  if (!r || !state) return null;
  return {
    state,
    requiredM: num(r.required_m),
    marginM: num(r.margin_m),
    sigmaM: num(r.sigma_m),
    pinch: parseRoutePinch(r.pinch),
    unverifiedLegs: nums(r.unverified_legs),
    unchecked: nums(r.unchecked),
    truncated: r.truncated === true,
  };
}
