/**
 * @module hud/cockpit-frames
 * @description Typed shapes and boundary parsers for the cockpit v2 nav-stream
 * kinds the agent computes for every surface: `pilot` (the command authority's
 * state), `obstacles` (radar sectors and per-camera nearness grids), `ar`
 * (projected route and motion items per camera) and `depth` (the model depth
 * grid). Payloads arrive snake case; the parsers narrow `unknown` into the
 * camelCase shapes the layer renderers read and return null for anything
 * malformed instead of guessing.
 *
 * Grids stay base64 strings here: the renderer decodes them into a reused
 * byte buffer (`decodeBase64Into`), so a frame costs no fresh allocation.
 *
 * Dependency-free on purpose apart from its siblings `pilot-fields.ts`,
 * `cockpit-grids.ts` (the `obstacles`/`depth` grids) and `cockpit-mission.ts`
 * (mission state, stall, place class and route check), both re-exported
 * here: Mission Control copies all four files byte for byte.
 *
 * @license GPL-3.0-only
 */

import {
  parsePositionUnverified,
  parseSpeedCap,
  parseStatusText,
  type FcStatusText,
  type PositionUnverified,
  type SpeedCap,
} from "./pilot-fields";
import {
  PLACE_CLASSES,
  parseMission,
  parseMissionStall,
  parseRouteCheck,
  type MissionStall,
  type MissionState,
  type PlaceClass,
  type RouteCheck,
} from "./cockpit-mission";

export type { FcStatusText, PositionUnverified, SpeedCap } from "./pilot-fields";
export {
  decodeBase64Into,
  decodeGridCode,
  gridCodeFor,
  parseDepthFrame,
  parseObstaclesFrame,
  type CameraGrid,
  type DepthFrame,
  type ObstaclesFrame,
} from "./cockpit-grids";
export {
  MISSION_STATES,
  PLACE_CLASSES,
  parseMission,
  parseMissionStall,
  parseRouteCheck,
  type MissionGap,
  type MissionStall,
  type MissionState,
  type MissionStateName,
  type MissionTarget,
  type PlaceClass,
  type RouteCheck,
  type RoutePinch,
} from "./cockpit-mission";

// ── small readers ─────────────────────────────────────────────────────────

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
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function oneOf<T extends string>(v: unknown, values: readonly T[]): T | null {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;
}
function pt2(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  return a === null || b === null ? null : [a, b];
}
function pt3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  const c = num(v[2]);
  return a === null || b === null || c === null ? null : [a, b, c];
}
function pts2(v: unknown, max = Infinity): [number, number][] {
  if (!Array.isArray(v)) return [];
  const out: [number, number][] = [];
  for (const p of v) {
    if (out.length >= max) break;
    const q = pt2(p);
    if (q) out.push(q);
  }
  return out;
}

// ── pilot (nav kind `pilot` with the flow fields) ────────────────────────────────────

export const PILOT_OWNERS = ["idle", "pilot", "skill", "goto", "swarm", "mission_fc", "fc_mode", "tuning"] as const;
export type PilotOwner = (typeof PILOT_OWNERS)[number];
export type AvoidState = "clear" | "detour" | "blocked" | "off" | "stale" | "unavailable";
export type VehicleClass = "multirotor" | "fixedwing" | "vtol";

export interface ReadinessItem {
  id: string;
  ok: boolean;
  severity: "block" | "warn";
  msg: string;
}

export interface PilotState {
  owner: PilotOwner;
  ownerLabel: string | null;
  skill: { pluginId: string; skillId: string; label: string } | null;
  controlMode: "ados" | "fc_manual" | "elrs" | null;
  profile: "cine" | "normal" | "sport" | null;
  avoid: "brake" | "bypass" | "off" | null;
  fcMode: number | null;
  fcModeName: string | null;
  /** Null while the pilot has no flight-controller link: the arm state is
   *  unknown, and every surface treats the drone as possibly airborne. */
  armed: boolean | null;
  landed: boolean | null;
  vehicleClass: VehicleClass | null;
  inputSrc: string | null;
  inputAgeMs: number | null;
  holdReason: string | null;
  avoidState: AvoidState | null;
  minClearanceM: number | null;
  goalNed: [number, number, number] | null;
  planNed: [number, number][];
  setpointNed: [number, number, number] | null;
  readiness: ReadinessItem[];
  linkLossInS: number | null;
  /** What the pilot does when the countdown ends; null from an agent that
   *  does not report it. */
  linkLossAction: "rth" | "rtl" | "hold" | "loiter" | "land" | null;
  /** The FC is flying a VTOL transition (either direction). */
  vtolTransitioning: boolean;
  mission: MissionState | null;
  inputSession: { src: string; label: string; session: number | null } | null;
  gate: { pending: boolean; progress: number } | null;
  sequence: {
    step: "checks" | "arm" | "takeoff" | "after" | "done";
    after: string | null;
    error: string | null;
    /** The supervised lift-off, from its spool-up until it hands over in the
     *  air or stops on the ground; null while the launch runs none. */
    liftoff: Liftoff | null;
  } | null;
  banner: { textKey: string; args: Record<string, unknown>; untilMs: number | null } | null;
  rthCountdownS: number | null;
  /** A mission or return that stopped making progress; null while none. */
  missionStall: MissionStall | null;
  /** Pilot actions this agent accepts from a surface (e.g. `goto`). */
  surfaceOps: string[];
  /** Height above ground, from a fresh downward rangefinder or the EKF
   *  height above home. */
  aglM: number | null;
  aglSource: "rangefinder" | "home" | null;
  /** FC STATUSTEXT at WARNING or worse from the last 30 s, newest first. */
  statustext: FcStatusText[];
  /** The setup step a tuning flight is on (owner `tuning`), or null. */
  setupStep: string | null;
  /** The FC flies an RTL or land of its own (a failsafe, not an operator's
   *  mode change). The agent omits `fc_failsafe` while it is false. */
  fcFailsafe: boolean;
  /** Why `fcFailsafe`: `rc_or_failsafe` (RC input was present, so an RC
   *  switch is possible) or `fc`; null while not in a failsafe. */
  failsafeCause: string | null;
  /** The setup-strings key (`setup.blocker.aborted_<reason>`) of the air
   *  wizard's last abort that was not the operator's while the engine still
   *  shows it, or null. */
  setupAbort: string | null;
  /** The pilot's own low-battery action: `land` (it may fly without GNSS)
   *  or `rth`, while its countdown runs (`rthCountdownS`) and after it
   *  fired; null while none. */
  lowBatteryAction: "land" | "rth" | null;
  /** A horizontal speed cap the pilot applies to every setpoint it flies
   *  (`gnss-denied` while the EKF horizontal source is not GNSS,
   *  `confined-near` near the clearance limit in a confined place), or null. */
  speedCap: SpeedCap | null;
  /** The operator's place class; `open` from an agent that omits it. */
  placeClass: PlaceClass;
  /** The route check, while confined with a mission loaded; else null. */
  routeCheck: RouteCheck | null;
  /** The raw `sensors` block (parse with sensor-health); null when absent. */
  sensors: unknown;
  /** The pilot does not trust the horizontal position (an older agent sends
   *  none), or null. */
  positionUnverified: PositionUnverified | null;
}

const AVOID_STATES: readonly AvoidState[] = ["clear", "detour", "blocked", "off", "stale", "unavailable"];
const SEQ_STEPS = ["checks", "arm", "takeoff", "after", "done"] as const;
const LIFTOFF_PHASES = ["spool", "level", "probe", "lift", "climb", "done", "stopped"] as const;

/** The pilot's supervised lift-off (`sequence.liftoff`). */
export interface Liftoff {
  phase: (typeof LIFTOFF_PHASES)[number];
  /** The phase in the operator's words; while stopped, why. */
  text: string;
  /** `learned` (this airframe's trim from earlier flights) or `probe`. */
  trim: "learned" | "probe" | null;
  /** Tilt from the resting attitude, degrees. */
  tiltDeg: number | null;
}

function parseLiftoff(raw: unknown): Liftoff | null {
  const o = obj(raw);
  const phase = o ? oneOf(o.phase, LIFTOFF_PHASES) : null;
  if (!o || !phase) return null;
  return { phase, text: str(o.text) ?? "", trim: oneOf(o.trim, ["learned", "probe"] as const), tiltDeg: num(o.tilt_deg) };
}

export function parsePilotState(raw: unknown): PilotState | null {
  const p = obj(raw);
  if (!p) return null;
  const owner = oneOf(p.owner, PILOT_OWNERS);
  if (!owner) return null;
  const sk = obj(p.skill);
  const skill =
    sk && str(sk.plugin_id) !== null && str(sk.skill_id) !== null
      ? { pluginId: sk.plugin_id as string, skillId: sk.skill_id as string, label: str(sk.label) ?? (sk.skill_id as string) }
      : null;
  const readiness: ReadinessItem[] = [];
  if (Array.isArray(p.readiness)) {
    for (const r of p.readiness) {
      const o = obj(r);
      const id = o ? str(o.id) : null;
      if (!o || id === null) continue;
      readiness.push({
        id,
        ok: o.ok === true,
        severity: o.severity === "warn" ? "warn" : "block",
        msg: str(o.msg) ?? "",
      });
    }
  }
  const is = obj(p.input_session);
  const gate = obj(p.gate);
  const seq = obj(p.sequence);
  const seqStep = seq ? oneOf(seq.step, SEQ_STEPS) : null;
  const banner = obj(p.banner);
  return {
    owner,
    ownerLabel: str(p.owner_label),
    skill,
    controlMode: oneOf(p.control_mode, ["ados", "fc_manual", "elrs"] as const),
    profile: oneOf(p.profile, ["cine", "normal", "sport"] as const),
    avoid: oneOf(p.avoid, ["brake", "bypass", "off"] as const),
    fcMode: num(p.fc_mode),
    fcModeName: str(p.fc_mode_name),
    armed: typeof p.armed === "boolean" ? p.armed : null,
    landed: typeof p.landed === "boolean" ? p.landed : null,
    vehicleClass: oneOf(p.vehicle_class, ["multirotor", "fixedwing", "vtol"] as const),
    inputSrc: str(p.input_src),
    inputAgeMs: num(p.input_age_ms),
    holdReason: str(p.hold_reason),
    avoidState: oneOf(p.avoid_state, AVOID_STATES),
    minClearanceM: num(p.min_clearance_m),
    goalNed: pt3(p.goal_ned),
    planNed: pts2(p.plan_ned, 16),
    setpointNed: pt3(p.setpoint_ned),
    readiness,
    linkLossInS: num(p.link_loss_in_s),
    linkLossAction: oneOf(p.link_loss_action, ["rth", "rtl", "hold", "loiter", "land"] as const),
    vtolTransitioning: p.vtol_transitioning === true,
    mission: parseMission(p.mission),
    inputSession: is && str(is.src) !== null ? { src: is.src as string, label: str(is.label) ?? (is.src as string), session: num(is.session) } : null,
    gate: gate ? { pending: gate.pending === true, progress: Math.min(1, Math.max(0, num(gate.progress) ?? 0)) } : null,
    sequence:
      seq && seqStep
        ? { step: seqStep, after: str(seq.after), error: str(seq.error), liftoff: parseLiftoff(seq.liftoff) }
        : null,
    banner:
      banner && str(banner.text_key) !== null
        ? { textKey: banner.text_key as string, args: obj(banner.args) ?? {}, untilMs: num(banner.until_ms) }
        : null,
    rthCountdownS: num(p.rth_countdown_s),
    missionStall: parseMissionStall(p.mission_stall),
    surfaceOps: Array.isArray(p.surface_ops) ? p.surface_ops.filter((o): o is string => typeof o === "string") : [],
    aglM: num(p.agl_m),
    aglSource: oneOf(p.agl_source, ["rangefinder", "home"] as const),
    statustext: parseStatusText(p.statustext),
    setupStep: str(p.setup_step),
    fcFailsafe: p.fc_failsafe === true,
    failsafeCause: str(p.failsafe_cause),
    setupAbort: str(p.setup_abort),
    lowBatteryAction: oneOf(p.low_battery_action, ["land", "rth"] as const),
    speedCap: parseSpeedCap(p.speed_cap),
    placeClass: oneOf(p.place_class, PLACE_CLASSES) ?? "open",
    routeCheck: parseRouteCheck(p.route_check),
    sensors: p.sensors ?? null,
    positionUnverified: parsePositionUnverified(p.position_unverified),
  };
}

// ── AR (nav kind `ar`, stable item keys) ─────────────────────────────────────────────────

export type ArItem =
  | { t: "wp"; k: string; seq: number; role: "next" | "after" | "other"; x: number; y: number; gx: number | null; gy: number | null; distM: number | null; etaS: number | null; size: number }
  | { t: "leg"; k: string; role: "active" | "next" | "future"; pts: [number, number][] }
  | { t: "home"; k: string; x: number; y: number; gx: number | null; gy: number | null; distM: number | null }
  | { t: "fpv"; k: string; x: number; y: number }
  | { t: "fpath"; k: string; state: AvoidState | null; pts: [number, number][] }
  | { t: "fgoal"; k: string; x: number; y: number }
  | { t: "orbit"; k: string; dir: "cw" | "ccw"; cx: number; cy: number; pts: [number, number][] }
  | { t: "edge"; k: string; of: "wp" | "home"; seq: number | null; ang: number; distM: number | null };

export interface ArCamera {
  frameW: number;
  frameH: number;
  reason: string | null;
  items: ArItem[];
}

export interface ArFrame {
  tsMs: number;
  approx: boolean;
  reason: string | null;
  mission: MissionState | null;
  cameras: Record<string, ArCamera>;
}

function parseArItem(raw: unknown): ArItem | null {
  const o = obj(raw);
  if (!o) return null;
  const k = str(o.k);
  switch (o.t) {
    case "wp": {
      const seq = num(o.seq);
      const role = oneOf(o.role, ["next", "after", "other"] as const);
      const x = num(o.x);
      const y = num(o.y);
      if (seq === null || !role || x === null || y === null) return null;
      return { t: "wp", k: k ?? `wp:${seq}`, seq, role, x, y, gx: num(o.gx), gy: num(o.gy), distM: num(o.dist_m), etaS: num(o.eta_s), size: num(o.size) ?? 0 };
    }
    case "leg": {
      const role = oneOf(o.role, ["active", "next", "future"] as const);
      const pts = pts2(o.pts);
      if (!role || pts.length < 2) return null;
      return { t: "leg", k: k ?? `leg:${role}`, role, pts };
    }
    case "home": {
      const x = num(o.x);
      const y = num(o.y);
      if (x === null || y === null) return null;
      return { t: "home", k: k ?? "home", x, y, gx: num(o.gx), gy: num(o.gy), distM: num(o.dist_m) };
    }
    case "fpv":
    case "fgoal": {
      const x = num(o.x);
      const y = num(o.y);
      if (x === null || y === null) return null;
      return { t: o.t, k: k ?? o.t, x, y };
    }
    case "fpath": {
      const pts = pts2(o.pts);
      if (pts.length < 2) return null;
      return { t: "fpath", k: k ?? "fpath", state: oneOf(o.state, AVOID_STATES), pts };
    }
    case "orbit": {
      const cx = num(o.cx);
      const cy = num(o.cy);
      const pts = pts2(o.pts);
      if (cx === null || cy === null || pts.length < 2) return null;
      return { t: "orbit", k: k ?? "orbit", dir: o.dir === "ccw" ? "ccw" : "cw", cx, cy, pts };
    }
    case "edge": {
      const of = oneOf(o.of, ["wp", "home"] as const);
      const ang = num(o.ang);
      if (!of || ang === null) return null;
      const seq = num(o.seq);
      return { t: "edge", k: k ?? `edge:${of === "home" ? "home" : `wp:${seq ?? "?"}`}`, of, seq, ang, distM: num(o.dist_m) };
    }
    default:
      return null;
  }
}

export function parseArFrame(raw: unknown): ArFrame | null {
  const o = obj(raw);
  const cams = o ? obj(o.cameras) : null;
  if (!o || !cams) return null;
  const cameras: Record<string, ArCamera> = {};
  for (const id of Object.keys(cams)) {
    const c = obj(cams[id]);
    if (!c) continue;
    const frameW = num(c.frame_w);
    const frameH = num(c.frame_h);
    if (frameW === null || frameH === null || frameW <= 0 || frameH <= 0) continue;
    const items: ArItem[] = [];
    if (Array.isArray(c.items)) {
      for (const it of c.items) {
        const item = parseArItem(it);
        if (item) items.push(item);
      }
    }
    cameras[id] = { frameW, frameH, reason: str(c.reason), items };
  }
  return {
    tsMs: num(o.ts_ms) ?? 0,
    approx: bool(o.approx) ?? false,
    reason: str(o.reason),
    mission: parseMission(o.mission),
    cameras,
  };
}

// ── surfaces (landing-zone candidates) ────────────────────────────────────

export interface SurfaceZone {
  pts: [number, number][];
  score: number;
  slopeDeg: number | null;
}

export interface SurfacesFrame {
  tsMs: number;
  cameraId: string;
  zones: SurfaceZone[];
}

export function parseSurfacesFrame(raw: unknown): SurfacesFrame | null {
  const o = obj(raw);
  const cameraId = o ? str(o.camera_id) : null;
  if (!o || cameraId === null || !Array.isArray(o.zones)) return null;
  const zones: SurfaceZone[] = [];
  for (const z of o.zones) {
    const zo = obj(z);
    const pts = zo ? pts2(zo.pts) : [];
    if (!zo || pts.length < 3) continue;
    zones.push({ pts, score: num(zo.score) ?? 0, slopeDeg: num(zo.slope_deg) });
  }
  return { tsMs: num(o.ts_ms) ?? 0, cameraId, zones };
}
