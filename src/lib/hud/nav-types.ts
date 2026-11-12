/**
 * @module hud/nav-types
 * @description Typed shapes and boundary parsers for the agent's navigation
 * feed: the follow-me `follow.state` and its discrete events, the vision-nav
 * `nav.state`, the world-engine pose / scan / map status topics, and the live
 * occupancy tiles. The agent forwards each source payload verbatim (snake
 * case); these parsers narrow `unknown` into the camelCase shapes the HUD and
 * the minimap read, dropping anything malformed instead of guessing.
 *
 * Frames: pose, occupancy and the follow target are in the map frame (x north,
 * y east, metres; the FC's LOCAL_POSITION_NED frame in the GNSS-denied
 * configuration). The scan is in the body FRD frame.
 *
 * @license GPL-3.0-only
 */

export type FollowPhase =
  | "idle"
  | "acquiring"
  | "following"
  | "coasting"
  | "searching"
  | "lost"
  | "holding";

export type ReacquireMode = "strict" | "smart";
export type AglSource = "rng" | "baro";
export type RangeCueKind = "ground" | "box_height" | "lidar";
export type NavHealth = "good" | "degraded" | "lost";

export interface RangeCue {
  kind: RangeCueKind;
  rangeM: number;
  sigmaM: number;
}

/** The follow target's predicted box, projected into the designate camera. */
export interface PredictedBbox {
  cameraId: string;
  frameW: number;
  frameH: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The follow-me `follow.state` payload. Absent fields are null. */
export interface FollowState {
  active: boolean | null;
  phase: FollowPhase;
  trackId: number | null;
  confidence: number | null;
  rangeM: number | null;
  rangeSigmaM: number | null;
  rangeCues: RangeCue[];
  targetSpeedMps: number | null;
  aglM: number | null;
  aglSource: AglSource | null;
  reacquireMode: ReacquireMode | null;
  coastRemainingS: number | null;
  pipelineLatencyMs: number | null;
  holdReason: string | null;
  bearingDeg: number | null;
  depressionDeg: number | null;
  targetNed: [number, number] | null;
  targetVelNed: [number, number] | null;
  predictedBbox: PredictedBbox | null;
}

export type FollowEvent =
  | { topic: "follow.reacquired"; trackId: number; similarity: number; gapS: number }
  | { topic: "follow.lost"; trackId: number | null; reason: string };

/** The vision-nav `nav.state` payload. */
export interface NavState {
  mode: string;
  activeSet: 1 | 2 | 3 | null;
  extnavHealth: NavHealth | null;
  odomRateHz: number | null;
  lastResetCounter: number | null;
  obstacleRateHz: number | null;
  minObstacleM: number | null;
  gpsFix: number | null;
  /** Age of the newest pose in ms (`pose_age_ms`), null while none. */
  poseAgeMs: number | null;
}

/** The world-engine pose: rotation `R` (row-major 3×3) and translation `t`
 * of the body FRD frame in the map frame. */
export interface NavPose {
  R: number[];
  t: [number, number, number];
  health: NavHealth | null;
  frame: string;
  source: string | null;
}

/** One planar scan in the body FRD frame. `ranges[i]` sits at
 * `angleStartRad + i·angleIncrementRad`, clockwise from forward; 0 = no
 * return. */
export interface NavScan {
  frame: string;
  angleStartRad: number;
  angleIncrementRad: number;
  ranges: number[];
}

export type MapPlacement = "onboard" | "stream" | "post_flight" | "hybrid";
export type UploadState = "idle" | "queued" | "uploading" | "done" | "failed";
export type StreamState = "off" | "connecting" | "live" | "degraded";

/** The world-engine `map_status` payload. */
export interface MapStatus {
  sessionId: string | null;
  placement: MapPlacement | null;
  memoryUsedMb: number | null;
  memoryBudgetMb: number | null;
  voxelM: number | null;
  keyframesDropped: number | null;
  sweepPoints: number | null;
  areaM2: number | null;
  navPose: "always" | "capture" | null;
  upload: { state: UploadState; bytesDone: number; bytesTotal: number } | null;
  stream: { state: StreamState; bytesPerS: number } | null;
}

export interface OccupancyTileWire {
  ix: number;
  iy: number;
  pngB64: string;
}

/** `GET /api/v1/map/live` response. `resM`/`tileCells` are null before the
 * first tile. */
export interface OccupancyLive {
  seq: number;
  frame: string;
  resM: number | null;
  tileCells: number | null;
  tiles: OccupancyTileWire[];
}

// ── narrowing helpers ────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function pair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  return a === null || b === null ? null : [a, b];
}

const PHASES: readonly FollowPhase[] = [
  "idle",
  "acquiring",
  "following",
  "coasting",
  "searching",
  "lost",
  "holding",
];
const HEALTH: readonly NavHealth[] = ["good", "degraded", "lost"];
const CUE_KINDS: readonly RangeCueKind[] = ["ground", "box_height", "lidar"];

function predictedBbox(v: unknown): PredictedBbox | null {
  if (!isRec(v)) return null;
  const cameraId = str(v.camera_id);
  const frameW = num(v.frame_w);
  const frameH = num(v.frame_h);
  const x = num(v.x);
  const y = num(v.y);
  const w = num(v.w);
  const h = num(v.h);
  if (cameraId === null || frameW === null || frameH === null) return null;
  if (x === null || y === null || w === null || h === null) return null;
  return { cameraId, frameW, frameH, x, y, w, h };
}

function rangeCues(v: unknown): RangeCue[] {
  if (!Array.isArray(v)) return [];
  const out: RangeCue[] = [];
  for (const c of v) {
    if (!isRec(c)) continue;
    const kind = oneOf(c.kind, CUE_KINDS);
    const rangeM = num(c.range_m);
    const sigmaM = num(c.sigma_m);
    if (kind && rangeM !== null) out.push({ kind, rangeM, sigmaM: sigmaM ?? 0 });
  }
  return out;
}

/** Parse a `follow.state` payload. A payload with no recognisable phase maps
 * to `idle` when `active` is false, `following` when an older plugin reports
 * `active` + `commanding`, else null. */
export function parseFollowState(raw: unknown): FollowState | null {
  if (!isRec(raw)) return null;
  const active = typeof raw.active === "boolean" ? raw.active : null;
  let phase = oneOf(raw.phase, PHASES);
  if (phase === null) {
    if (active === false) phase = "idle";
    else if (active === true && raw.commanding === true) phase = "following";
    else if (active === true) phase = "acquiring";
    else return null;
  }
  return {
    active,
    phase,
    trackId: int(raw.track_id),
    confidence: num(raw.confidence),
    rangeM: num(raw.range_m),
    rangeSigmaM: num(raw.range_sigma_m),
    rangeCues: rangeCues(raw.range_cues),
    targetSpeedMps: num(raw.target_speed_mps),
    aglM: num(raw.agl_m),
    aglSource: oneOf(raw.agl_source, ["rng", "baro"] as const),
    reacquireMode: oneOf(raw.reacquire_mode, ["strict", "smart"] as const),
    coastRemainingS: num(raw.coast_remaining_s),
    pipelineLatencyMs: num(raw.pipeline_latency_ms),
    holdReason: str(raw.hold_reason),
    bearingDeg: num(raw.bearing_deg),
    depressionDeg: num(raw.depression_deg),
    targetNed: pair(raw.target_ned),
    targetVelNed: pair(raw.target_vel_ned),
    predictedBbox: predictedBbox(raw.predicted_bbox),
  };
}

/** Parse a `follow.reacquired` / `follow.lost` event payload. */
export function parseFollowEvent(topic: unknown, raw: unknown): FollowEvent | null {
  if (!isRec(raw)) return null;
  if (topic === "follow.reacquired") {
    const trackId = int(raw.track_id);
    if (trackId === null) return null;
    return {
      topic,
      trackId,
      similarity: num(raw.similarity) ?? 0,
      gapS: num(raw.gap_s) ?? 0,
    };
  }
  if (topic === "follow.lost") {
    return { topic, trackId: int(raw.track_id), reason: str(raw.reason) ?? "lock_lost" };
  }
  return null;
}

export function parseNavState(raw: unknown): NavState | null {
  if (!isRec(raw)) return null;
  const mode = str(raw.mode);
  if (mode === null) return null;
  const set = int(raw.active_set);
  return {
    mode,
    activeSet: set === 1 || set === 2 || set === 3 ? set : null,
    extnavHealth: oneOf(raw.extnav_health, HEALTH),
    odomRateHz: num(raw.odom_rate_hz),
    lastResetCounter: int(raw.last_reset_counter),
    obstacleRateHz: num(raw.obstacle_rate_hz),
    minObstacleM: num(raw.min_obstacle_m),
    gpsFix: int(raw.gps_fix),
    poseAgeMs: num(raw.pose_age_ms),
  };
}

export function parseNavPose(raw: unknown): NavPose | null {
  if (!isRec(raw)) return null;
  const body = isRec(raw.pose) ? raw.pose : raw;
  const R = Array.isArray(body.R) ? body.R.map((v) => num(v)) : [];
  const t = Array.isArray(body.t) ? body.t.map((v) => num(v)) : [];
  if (R.length !== 9 || R.some((v) => v === null)) return null;
  if (t.length !== 3 || t.some((v) => v === null)) return null;
  return {
    R: R as number[],
    t: t as [number, number, number],
    health: oneOf(raw.health, HEALTH),
    frame: str(raw.frame) ?? "map_ned",
    source: str(raw.source),
  };
}

export function parseNavScan(raw: unknown): NavScan | null {
  if (!isRec(raw) || !Array.isArray(raw.ranges_m)) return null;
  const angleStartRad = num(raw.angle_start_rad);
  const angleIncrementRad = num(raw.angle_increment_rad);
  if (angleStartRad === null || angleIncrementRad === null || angleIncrementRad === 0) return null;
  return {
    frame: str(raw.frame) ?? "body_frd",
    angleStartRad,
    angleIncrementRad,
    ranges: raw.ranges_m.map((v) => num(v) ?? 0),
  };
}

export function parseMapStatus(raw: unknown): MapStatus | null {
  if (!isRec(raw)) return null;
  const upload = isRec(raw.upload)
    ? {
        state:
          oneOf(raw.upload.state, ["idle", "queued", "uploading", "done", "failed"] as const) ??
          "idle",
        bytesDone: num(raw.upload.bytes_done) ?? 0,
        bytesTotal: num(raw.upload.bytes_total) ?? 0,
      }
    : null;
  const stream = isRec(raw.stream)
    ? {
        state:
          oneOf(raw.stream.state, ["off", "connecting", "live", "degraded"] as const) ?? "off",
        bytesPerS: num(raw.stream.bytes_per_s) ?? 0,
      }
    : null;
  return {
    sessionId: str(raw.session_id),
    placement: oneOf(raw.placement, ["onboard", "stream", "post_flight", "hybrid"] as const),
    memoryUsedMb: num(raw.memory_used_mb),
    memoryBudgetMb: num(raw.memory_budget_mb),
    voxelM: num(raw.voxel_m),
    keyframesDropped: int(raw.keyframes_dropped),
    sweepPoints: int(raw.sweep_points),
    areaM2: num(raw.area_m2),
    navPose: oneOf(raw.nav_pose, ["always", "capture"] as const),
    upload,
    stream,
  };
}

export function parseOccupancyLive(raw: unknown): OccupancyLive | null {
  if (!isRec(raw)) return null;
  const seq = int(raw.seq);
  if (seq === null) return null;
  const tiles: OccupancyTileWire[] = [];
  if (Array.isArray(raw.tiles)) {
    for (const t of raw.tiles) {
      if (!isRec(t)) continue;
      const ix = int(t.ix);
      const iy = int(t.iy);
      const pngB64 = str(t.png_b64);
      if (ix !== null && iy !== null && pngB64 !== null) tiles.push({ ix, iy, pngB64 });
    }
  }
  return {
    seq,
    frame: str(raw.frame) ?? "map_ned",
    resM: num(raw.res_m),
    tileCells: int(raw.tile_cells),
    tiles,
  };
}
