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
 * Dependency-free on purpose: Mission Control copies this file byte for byte.
 *
 * @license GPL-3.0-only
 */

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

// ── mission state ────────────────────────────────────────────────────

export const MISSION_STATES = ["none", "loaded", "active", "paused", "complete", "returning"] as const;
export type MissionStateName = (typeof MISSION_STATES)[number];

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
  };
}

// ── pilot (nav kind `pilot` with the flow fields) ────────────────────────────────────

export const PILOT_OWNERS = ["idle", "pilot", "skill", "goto", "swarm", "mission_fc", "fc_mode", "tuning"] as const;
export type PilotOwner = (typeof PILOT_OWNERS)[number];
export type AvoidState = "clear" | "detour" | "blocked" | "off";
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
  armed: boolean;
  landed: boolean;
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
  sequence: { step: "checks" | "arm" | "takeoff" | "after" | "done"; after: string | null; error: string | null } | null;
  banner: { textKey: string; args: Record<string, unknown>; untilMs: number | null } | null;
  rthCountdownS: number | null;
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
}

/** One FC STATUSTEXT line; severity is MAVLink's (0 emergency … 4 warning). */
export interface FcStatusText {
  severity: number;
  text: string;
  ageMs: number;
}

const AVOID_STATES: readonly AvoidState[] = ["clear", "detour", "blocked", "off"];
const SEQ_STEPS = ["checks", "arm", "takeoff", "after", "done"] as const;

function parseStatusText(raw: unknown): FcStatusText[] {
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
    armed: p.armed === true,
    landed: p.landed !== false,
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
    sequence: seq && seqStep ? { step: seqStep, after: str(seq.after), error: str(seq.error) } : null,
    banner:
      banner && str(banner.text_key) !== null
        ? { textKey: banner.text_key as string, args: obj(banner.args) ?? {}, untilMs: num(banner.until_ms) }
        : null,
    rthCountdownS: num(p.rth_countdown_s),
    surfaceOps: Array.isArray(p.surface_ops) ? p.surface_ops.filter((o): o is string => typeof o === "string") : [],
    aglM: num(p.agl_m),
    aglSource: oneOf(p.agl_source, ["rangefinder", "home"] as const),
    statustext: parseStatusText(p.statustext),
    setupStep: str(p.setup_step),
  };
}

// ── per-camera grids (nav kinds `obstacles` / `depth`) ───────────────────────────

/** A per-camera grid: `near` holds cols·rows log-coded distances (0 =
 *  unknown); `measured` is a cols·rows bitmask (1 = from LiDAR/occupancy). */
export interface CameraGrid {
  cols: number;
  rows: number;
  near: string;
  measured: string | null;
  /** Depth only: per-camera scale source (authoritative over the frame's). */
  scaleSource: "lidar" | "none" | null;
}

function parseGrids(raw: unknown): Record<string, CameraGrid> {
  const out: Record<string, CameraGrid> = {};
  const cams = obj(raw);
  if (!cams) return out;
  for (const id of Object.keys(cams)) {
    const g = obj(cams[id]);
    if (!g) continue;
    const cols = num(g.cols);
    const rows = num(g.rows);
    const near = str(g.near);
    if (cols === null || rows === null || near === null || cols <= 0 || rows <= 0 || cols * rows > 65536) continue;
    out[id] = { cols, rows, near, measured: str(g.measured), scaleSource: oneOf(g.scale_source, ["lidar", "none"] as const) };
  }
  return out;
}

export interface ObstaclesFrame {
  tsMs: number;
  /** 72 × 5° sectors, body yaw 0 = nose, clockwise; null = no return. */
  sectorsM: (number | null)[];
  cameras: Record<string, CameraGrid>;
}

export function parseObstaclesFrame(raw: unknown): ObstaclesFrame | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.sectors_m)) return null;
  const sectorsM: (number | null)[] = [];
  for (let i = 0; i < 72; i++) sectorsM.push(num(o.sectors_m[i]));
  return { tsMs: num(o.ts_ms) ?? 0, sectorsM, cameras: parseGrids(o.cameras) };
}

export interface DepthFrame {
  tsMs: number;
  scaleSource: "lidar" | "none";
  cameras: Record<string, CameraGrid>;
}

export function parseDepthFrame(raw: unknown): DepthFrame | null {
  const o = obj(raw);
  if (!o || !obj(o.cameras)) return null;
  return {
    tsMs: num(o.ts_ms) ?? 0,
    scaleSource: o.scale_source === "lidar" ? "lidar" : "none",
    cameras: parseGrids(o.cameras),
  };
}

/** Grid cell code → metres: 0 is unknown (null); 1..255 span 0.2–60 m. */
export function decodeGridCode(v: number): number | null {
  if (v <= 0) return null;
  return 0.2 * Math.exp(((v - 1) * Math.log(300)) / 254);
}

/** Metres → the smallest code whose distance is ≥ `m` (for thresholds). */
export function gridCodeFor(m: number): number {
  if (m <= 0.2) return 1;
  return Math.min(255, Math.ceil((Math.log(m / 0.2) * 254) / Math.log(300) + 1));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62;
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/** Decode standard or url-safe base64 into `out` without allocating.
 *  Returns the byte count written (capped at `out.length`). */
export function decodeBase64Into(s: string, out: Uint8Array): number {
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < s.length && n < out.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) continue; // padding, whitespace
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return n;
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
