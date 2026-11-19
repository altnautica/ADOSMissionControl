/**
 * @module hud/nav-types
 * @description Typed shapes and boundary parsers for the agent's navigation
 * feed: the follow-me `follow.state` and its discrete events, the Navigation
 * `plugin.navigation.state`, Navigation's pose / scan / map status topics, and the live
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

import { int, isRec, num, oneOf, pair, str } from "./nav-narrow";

/** The follow phase. Once the lock is lost the follow is `predicting` (flying
 * toward the predicted standoff), `repositioning` (flying to a vantage point
 * the pilot chose), `searching` (sweeping from the vantage point, widening in
 * steps), then `holding-await-operator` (stopped at a latched hover point,
 * waiting for the operator). */
export type FollowPhase =
  | "idle"
  | "acquiring"
  | "following"
  | "holding"
  | "predicting"
  | "repositioning"
  | "searching"
  | "holding-await-operator";

/** How the pilot's vantage point stands. */
export type VantageState = "enroute" | "arrived" | "no-vantage";
/** What hides the subject from the vantage: `narrow` (< 1.5 m wide: a trunk,
 * a column) or `wide` (a wall, a corner). */
export type OccluderKind = "narrow" | "wide";
export type UncertainMode = "follow" | "hold";

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

/** The search ellipse around the predicted subject position (map frame).
 * `headingDeg` is the major axis as a bearing, clockwise from north. */
export interface SearchArea {
  centerNe: [number, number];
  semiMajorM: number;
  semiMinorM: number;
  headingDeg: number;
}

export interface Occluder {
  ne: [number, number];
  kind: OccluderKind;
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
  /** Seconds left of the recovery's search budget. */
  reacquireRemainingS: number | null;
  searchBudgetS: number | null;
  /** 0-based widening step while searching, else null. */
  searchStep: number | null;
  searchArea: SearchArea | null;
  /** The predicted subject path while recovering (≤ 10 points, 0.5 s apart). */
  predictedPathNe: Array<[number, number]> | null;
  vantageNe: [number, number] | null;
  vantageState: VantageState | null;
  occluder: Occluder | null;
  /** The latched hover point while holding for the operator. */
  holdNe: [number, number] | null;
  uncertainMode: UncertainMode | null;
  predictiveSearch: boolean | null;
  /** A surface writes `operatorResumeSeq + 1` to resume searching. */
  operatorResumeSeq: number;
  /** The subject has been faster than `speedLimitMps` for a while. */
  outpaced: boolean;
  speedLimitMps: number | null;
  pipelineLatencyMs: number | null;
  holdReason: string | null;
  bearingDeg: number | null;
  depressionDeg: number | null;
  targetNed: [number, number] | null;
  targetVelNed: [number, number] | null;
  predictedBbox: PredictedBbox | null;
}

export type FollowEvent =
  | {
      topic: "follow.reacquired";
      trackId: number;
      similarity: number;
      gapS: number;
      /** Position gate distance of the re-locked candidate, in sigmas. */
      mahalanobis: number | null;
      /** The phase the re-lock happened in. */
      phase: FollowPhase | null;
    }
  | {
      topic: "follow.lost";
      trackId: number | null;
      /** `lock_lost`, `search_exhausted` or `predictive_search_off`. */
      reason: string;
      awaitingOperator: boolean;
      holdNe: [number, number] | null;
    }
  | { topic: "follow.stopped"; reason: string };

/** The Navigation `plugin.navigation.state` payload. */
export interface NavState {
  mode: string;
  activeSet: 1 | 2 | 3 | null;
  extnavHealth: NavHealth | null;
  /** Why the pose is degraded or lost (`health_reason`: `corridor_unmeasured`,
   *  `flow_disagrees`, `ekf_flow_disagree`, …); null when none is named or an
   *  older Navigation sends none. */
  healthReason: string | null;
  odomRateHz: number | null;
  lastResetCounter: number | null;
  obstacleRateHz: number | null;
  minObstacleM: number | null;
  gpsFix: number | null;
  /** Age of the newest pose in ms (`pose_age_ms`), null while none. */
  poseAgeMs: number | null;
}

/** Navigation's pose: rotation `R` (row-major 3×3) and translation `t`
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
export type PoseProvider = "lidar_planar" | "fc_ekf" | "vio" | "replay";
export type ImuFeedState = "ok" | "degraded" | "lost";

/** The FC IMU feed of a planar LiDAR pose that takes the flight controller as
 * its IMU; `reason` is null while the feed is ok. */
export interface ImuFeed {
  state: ImuFeedState;
  reason: string | null;
  rateHz: number | null;
}

/** Navigation's `map_status` payload: the live map's own facts. */
export interface MapStatus {
  placement: MapPlacement | null;
  memoryUsedMb: number | null;
  memoryBudgetMb: number | null;
  voxelM: number | null;
  sweepPoints: number | null;
  areaM2: number | null;
  poseProvider: PoseProvider | null;
  imuFeed: ImuFeed | null;
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

/** Every follow phase, in lifecycle order. */
export const PHASES: readonly FollowPhase[] = [
  "idle",
  "acquiring",
  "following",
  "holding",
  "predicting",
  "repositioning",
  "searching",
  "holding-await-operator",
];
/** The phases in which the lock is lost and the subject is being sought. */
export const RECOVERY_PHASES: readonly FollowPhase[] = ["predicting", "repositioning", "searching"];

export function isRecoveryPhase(phase: FollowPhase): boolean {
  return RECOVERY_PHASES.includes(phase);
}

const HEALTH: readonly NavHealth[] = ["good", "degraded", "lost"];
const CUE_KINDS: readonly RangeCueKind[] = ["ground", "box_height", "lidar"];

function pairs(v: unknown): Array<[number, number]> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<[number, number]> = [];
  for (const p of v) {
    const q = pair(p);
    if (q) out.push(q);
  }
  return out.length > 0 ? out : null;
}

function searchArea(v: unknown): SearchArea | null {
  if (!isRec(v)) return null;
  const centerNe = pair(v.center_ne);
  const semiMajorM = num(v.semi_major_m);
  const semiMinorM = num(v.semi_minor_m);
  const headingDeg = num(v.heading_deg);
  if (centerNe === null || semiMajorM === null || semiMinorM === null || headingDeg === null) return null;
  return { centerNe, semiMajorM, semiMinorM, headingDeg };
}

function occluder(v: unknown): Occluder | null {
  if (!isRec(v)) return null;
  const ne = pair(v.ne);
  const kind = oneOf(v.kind, ["narrow", "wide"] as const);
  return ne && kind ? { ne, kind } : null;
}

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

/** Parse a `follow.state` payload. Follow-me 0.4.9 and older report
 * `coasting` (flying on the prediction of a lost lock) and `lost` (holding):
 * they read as `predicting` and `holding`, never as a follow. A payload with
 * no recognisable phase maps to `idle` when `active` is false, `following`
 * when an older plugin reports `active` + `commanding`, else null. */
export function parseFollowState(raw: unknown): FollowState | null {
  if (!isRec(raw)) return null;
  const active = typeof raw.active === "boolean" ? raw.active : null;
  let phase =
    oneOf(raw.phase, PHASES) ??
    (raw.phase === "coasting" ? "predicting" : raw.phase === "lost" ? "holding" : null);
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
    reacquireRemainingS: num(raw.reacquire_remaining_s),
    searchBudgetS: num(raw.search_budget_s),
    searchStep: int(raw.search_step),
    searchArea: searchArea(raw.search_area),
    predictedPathNe: pairs(raw.predicted_path_ne),
    vantageNe: pair(raw.vantage_ne),
    vantageState: oneOf(raw.vantage_state, ["enroute", "arrived", "no-vantage"] as const),
    occluder: occluder(raw.occluder),
    holdNe: pair(raw.hold_ne),
    uncertainMode: oneOf(raw.uncertain_mode, ["follow", "hold"] as const),
    predictiveSearch: typeof raw.predictive_search === "boolean" ? raw.predictive_search : null,
    operatorResumeSeq: Math.max(0, int(raw.operator_resume_seq) ?? 0),
    outpaced: raw.outpaced === true,
    speedLimitMps: num(raw.speed_limit_mps),
    pipelineLatencyMs: num(raw.pipeline_latency_ms),
    holdReason: str(raw.hold_reason),
    bearingDeg: num(raw.bearing_deg),
    depressionDeg: num(raw.depression_deg),
    targetNed: pair(raw.target_ned),
    targetVelNed: pair(raw.target_vel_ned),
    predictedBbox: predictedBbox(raw.predicted_bbox),
  };
}

/** Parse a `follow.reacquired` / `follow.lost` / `follow.stopped` event
 * payload. */
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
      mahalanobis: num(raw.mahalanobis),
      phase: oneOf(raw.phase, PHASES),
    };
  }
  if (topic === "follow.lost") {
    return {
      topic,
      trackId: int(raw.track_id),
      reason: str(raw.reason) ?? "lock_lost",
      awaitingOperator: raw.awaiting_operator === true,
      holdNe: pair(raw.hold_ne),
    };
  }
  if (topic === "follow.stopped") {
    return { topic, reason: str(raw.reason) ?? "revoked" };
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
    healthReason: str(raw.health_reason),
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
  const feedState = isRec(raw.imu_feed)
    ? oneOf(raw.imu_feed.state, ["ok", "degraded", "lost"] as const)
    : null;
  const imuFeed =
    isRec(raw.imu_feed) && feedState
      ? { state: feedState, reason: str(raw.imu_feed.reason), rateHz: num(raw.imu_feed.rate_hz) }
      : null;
  return {
    placement: oneOf(raw.placement, ["onboard", "stream", "post_flight", "hybrid"] as const),
    memoryUsedMb: num(raw.memory_used_mb),
    memoryBudgetMb: num(raw.memory_budget_mb),
    voxelM: num(raw.voxel_m),
    sweepPoints: int(raw.sweep_points),
    areaM2: num(raw.area_m2),
    poseProvider: oneOf(raw.pose_provider, ["lidar_planar", "fc_ekf", "vio", "replay"] as const),
    imuFeed,
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
