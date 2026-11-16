/**
 * @module mock/mock-hud-script
 * @description The scripted 32 s demo cycle behind the HUD target symbology.
 * Eight states of 4 s each walk the designated subject through every target
 * state the cockpit draws:
 *
 *   candidate → tracked → locked → following → predicting → searching →
 *   re-acquired → awaiting (holding for the operator) → (loop)
 *
 * The recovery (predicting, then moving to look at the vantage point, then
 * searching from it) spends an 8 s search budget and carries the search area,
 * the predicted path, the vantage point and what hides the subject; the
 * search finds it again under a new track, and the next loss exhausts the
 * search and holds for the operator. The searching state opens with
 * {@link REPOSITION_TO_S} of moving to look (`repositioning`).
 *
 * Pure functions of the cycle clock: the detection batch, the follow-me
 * `follow.state` frame and the one-shot effects (designation, follow events)
 * that fire when a state begins. The demo stream drivers in
 * `mock-detections.ts` and `mock-nav.ts` call these on their timers.
 * @license GPL-3.0-only
 */

import {
  isRecoveryPhase,
  type FollowEvent,
  type FollowPhase,
  type FollowState,
  type NavHealth,
  type PredictedBbox,
  type ReacquireMode,
  type UncertainMode,
} from "@/lib/hud/nav-types";
import type { DetectionBox, VisionDetection } from "@/stores/vision-detections-store";

export const HUD_STATE_S = 4;
export const HUD_STATES = [
  "candidate",
  "tracked",
  "locked",
  "following",
  "predicting",
  "searching",
  "reacquired",
  "awaiting",
] as const;
export type HudDemoState = (typeof HUD_STATES)[number];
export const HUD_CYCLE_S = HUD_STATE_S * HUD_STATES.length;

/** Frame the synthetic boxes are expressed in (a common 4:3 inference size). */
export const FRAME_WIDTH = 640;
export const FRAME_HEIGHT = 480;

export const TARGET_TRACK = 12;
export const REACQUIRED_TRACK = 15;
export const BACKGROUND_TRACK = 7;

/** Sub-windows inside a state (seconds from the state's start). */
export const ACQUIRING_FROM_S = 3;
export const UNCERTAIN_FROM_S = 1;
export const UNCERTAIN_TO_S = 2;
export const HOLDING_FROM_S = 3;
export const OFFFRAME_FROM_S = 2;
/** The searching state flies to the vantage point (`repositioning`) first. */
export const REPOSITION_TO_S = 1;

export const HOLD_REASON_NO_RANGE = "HOLD_NO_RANGE";
/** Why the demo follow holds for the operator: the search found nothing. */
export const HOLD_REASON_SEARCH_EXHAUSTED = "search-exhausted";
export const REACQUIRED_SIMILARITY = 0.86;
export const REACQUIRED_GAP_S = 1.8;
export const REACQUIRED_MAHALANOBIS = 1.2;

/** The recovery's search budget (s): predicting and searching spend it. */
export const SEARCH_BUDGET_S = 2 * HUD_STATE_S;
/** Seconds per widening step while searching; three steps. */
const SEARCH_STEP_S = 1.5;
const SEARCH_STEPS = 3;

/** Camera geometry used to turn a box into a bearing and depression. */
const CAMERA_HFOV_DEG = 70;
const CAMERA_VFOV_DEG = 52;
const CAMERA_TILT_DEG = 12;
/** Bearing of the subject relative to the nose while it is off-frame. */
const OFFFRAME_REL_DEG = 72;
/** Predicted-box drift while predicting / searching (px/s). */
const PREDICT_DRIFT_PX_S = 22;

export interface HudStateAt {
  state: HudDemoState;
  index: number;
  /** Seconds since the state began. */
  localS: number;
  /** Completed cycles before this one. */
  cycle: number;
}

/** Which scripted state is showing `tSec` seconds after the stream started. */
export function hudStateAt(tSec: number): HudStateAt {
  const t = Math.max(0, tSec);
  const cycle = Math.floor(t / HUD_CYCLE_S);
  const inCycle = t - cycle * HUD_CYCLE_S;
  const index = Math.min(HUD_STATES.length - 1, Math.floor(inCycle / HUD_STATE_S));
  return { state: HUD_STATES[index], index, localS: inCycle - index * HUD_STATE_S, cycle };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function boxAt(cx: number, cy: number, w: number, h: number): DetectionBox {
  return {
    x: clamp(cx - w / 2, 0, FRAME_WIDTH - w),
    y: clamp(cy - h / 2, 0, FRAME_HEIGHT - h),
    width: w,
    height: h,
  };
}

/** The followed subject's walk across the frame. Sized and placed so its
 * bottom tags and feet tick clear the range panel. */
export function targetBox(tSec: number): DetectionBox {
  const w = 64 + 5 * Math.sin(0.2 * tSec);
  return boxAt(300 + 70 * Math.sin(0.35 * tSec), 210 + 10 * Math.sin(0.9 * tSec), w, w * 2.15);
}

/** Where the subject reappears under its new track id. */
export function reacquiredBox(tSec: number): DetectionBox {
  return boxAt(470 + 35 * Math.sin(0.5 * tSec), 210 + 8 * Math.sin(0.7 * tSec), 62, 132);
}

function backgroundBoxes(tSec: number): VisionDetection[] {
  return [
    {
      bbox: boxAt(120 + 30 * Math.sin(0.25 * tSec), 300, 60, 130),
      classLabel: "person",
      confidence: 0.84,
      trackId: BACKGROUND_TRACK,
      assocConfidence: 0.84,
      lockState: "locked",
    },
    {
      bbox: boxAt(540, 380 + 4 * Math.sin(0.4 * tSec), 110, 70),
      classLabel: "car",
      confidence: 0.58,
      trackId: null,
      lockState: null,
    },
    // Below the candidate threshold: present in the batch, never drawn.
    {
      bbox: boxAt(60, 80, 40, 84),
      classLabel: "person",
      confidence: 0.32,
      trackId: null,
      lockState: null,
    },
  ];
}

function tracked(bbox: DetectionBox, trackId: number, confidence: number, uncertain = false): VisionDetection {
  return {
    bbox,
    classLabel: "person",
    confidence,
    trackId,
    assocConfidence: confidence,
    lockState: uncertain ? "uncertain" : "locked",
  };
}

function isUncertain(at: HudStateAt): boolean {
  return at.state === "following" && at.localS >= UNCERTAIN_FROM_S && at.localS < UNCERTAIN_TO_S;
}

/** The detection batch content at `tSec`. */
export function scriptDetections(tSec: number): VisionDetection[] {
  const at = hudStateAt(tSec);
  const out = backgroundBoxes(tSec);
  switch (at.state) {
    case "candidate":
      out.push({ bbox: targetBox(tSec), classLabel: "person", confidence: 0.72, trackId: null, lockState: null });
      break;
    case "tracked":
    case "locked":
      out.push(tracked(targetBox(tSec), TARGET_TRACK, 0.88));
      break;
    case "following":
      out.push(isUncertain(at) ? tracked(targetBox(tSec), TARGET_TRACK, 0.61, true) : tracked(targetBox(tSec), TARGET_TRACK, 0.88));
      break;
    case "reacquired":
      out.push(tracked(reacquiredBox(tSec), REACQUIRED_TRACK, 0.83));
      break;
    case "predicting":
    case "searching":
    case "awaiting":
      break;
  }
  return out;
}

/** One-shot effects that fire when a state begins. */
export interface HudEntryEffect {
  /** Drop any demo designation. */
  release: boolean;
  /** Designate this track (with its live detection). */
  designateTrack: number | null;
  event: FollowEvent | null;
}

export function entryEffect(state: HudDemoState): HudEntryEffect {
  switch (state) {
    case "candidate":
      return { release: true, designateTrack: null, event: null };
    case "locked":
      return { release: false, designateTrack: TARGET_TRACK, event: null };
    case "reacquired":
      return {
        release: false,
        designateTrack: REACQUIRED_TRACK,
        event: {
          topic: "follow.reacquired",
          trackId: REACQUIRED_TRACK,
          similarity: REACQUIRED_SIMILARITY,
          gapS: REACQUIRED_GAP_S,
          mahalanobis: REACQUIRED_MAHALANOBIS,
          phase: "searching",
        },
      };
    case "awaiting":
      // The search ran out: follow-me holds for the operator and keeps the
      // designation, so searching again seeks the same subject.
      return {
        release: false,
        designateTrack: null,
        event: {
          topic: "follow.lost",
          trackId: REACQUIRED_TRACK,
          reason: "search_exhausted",
          awaitingOperator: true,
          holdNe: null,
        },
      };
    default:
      return { release: false, designateTrack: null, event: null };
  }
}

/** The follow-me phase at `tSec`. */
export function followPhaseAt(tSec: number): FollowPhase {
  const at = hudStateAt(tSec);
  switch (at.state) {
    case "candidate":
    case "tracked":
      return "idle";
    case "locked":
      return at.localS >= ACQUIRING_FROM_S ? "acquiring" : "idle";
    case "following":
      return at.localS >= HOLDING_FROM_S ? "holding" : "following";
    case "predicting":
      return "predicting";
    case "searching":
      return at.localS < REPOSITION_TO_S ? "repositioning" : "searching";
    case "reacquired":
      return "following";
    case "awaiting":
      return "holding-await-operator";
  }
}

/** External-nav / SLAM health: degraded while the subject is being searched
 * for, good otherwise. */
export function extnavHealthAt(tSec: number): NavHealth {
  return hudStateAt(tSec).state === "searching" ? "degraded" : "good";
}

/** The predicted box while predicting / searching on-frame, else null. */
export function predictedBoxAt(tSec: number): DetectionBox | null {
  const at = hudStateAt(tSec);
  const offFrame = at.state === "searching" && at.localS >= OFFFRAME_FROM_S;
  if ((at.state !== "predicting" && at.state !== "searching") || offFrame) return null;
  const lossStart = at.cycle * HUD_CYCLE_S + 4 * HUD_STATE_S;
  const last = targetBox(lossStart);
  const dt = tSec - lossStart;
  const shrink = 1 - 0.04 * dt;
  const w = last.width * shrink;
  const h = last.height * shrink;
  return boxAt(last.x + last.width / 2 + PREDICT_DRIFT_PX_S * dt, last.y + last.height / 2, w, h);
}

export interface FollowContext {
  cameraId: string;
  /** Vehicle heading (deg, clockwise from north). */
  vehicleYawDeg: number;
  reacquireMode: ReacquireMode;
  /** Drone position in the local map frame (north, east). */
  droneNed: [number, number];
  /** The echoed when-unsure setting (default `follow`). */
  uncertainMode?: UncertainMode;
  /** The echoed predictive search switch (default on). */
  predictiveSearch?: boolean;
  /** Where the hold for the operator latched; the drone position when absent. */
  holdNe?: [number, number] | null;
  /** The echoed `operator_resume_seq` (default 0). */
  operatorResumeSeq?: number;
}

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function round(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function roundNe([n, e]: readonly [number, number]): [number, number] {
  return [round(n, 0.01), round(e, 0.01)];
}

/**
 * The `follow.state` frame at `tSec`. `phase` replaces the scripted phase (a
 * demo pin holding `repositioning`, which the cycle flies only as searching);
 * pass the matching `pinnedCycleS` (mock-follow-pin) as `tSec`.
 */
export function scriptFollow(tSec: number, ctx: FollowContext, phase: FollowPhase = followPhaseAt(tSec)): FollowState {
  const at = hudStateAt(tSec);
  const base: FollowState = {
    active: phase !== "idle",
    phase,
    trackId: null,
    confidence: null,
    rangeM: null,
    rangeSigmaM: null,
    rangeCues: [],
    targetSpeedMps: null,
    aglM: null,
    aglSource: null,
    reacquireMode: ctx.reacquireMode,
    reacquireRemainingS: null,
    searchBudgetS: null,
    searchStep: null,
    searchArea: null,
    predictedPathNe: null,
    vantageNe: null,
    vantageState: null,
    occluder: null,
    holdNe: null,
    uncertainMode: ctx.uncertainMode ?? "follow",
    predictiveSearch: ctx.predictiveSearch ?? true,
    operatorResumeSeq: ctx.operatorResumeSeq ?? 0,
    outpaced: false,
    speedLimitMps: null,
    pipelineLatencyMs: null,
    holdReason: null,
    bearingDeg: null,
    depressionDeg: null,
    targetNed: null,
    targetVelNed: null,
    predictedBbox: null,
  };
  if (phase === "idle") return base;

  const reacq = at.state === "reacquired" || at.state === "awaiting";
  const trackId = reacq ? REACQUIRED_TRACK : TARGET_TRACK;
  const latencyMs = Math.round(82 + 8 * Math.sin(1.7 * tSec));
  const aglM = round(2 + 0.15 * Math.sin(0.3 * tSec), 0.01);
  if (phase === "holding-await-operator") {
    // Stopped at the latched hover point, waiting for the operator.
    return {
      ...base,
      trackId,
      pipelineLatencyMs: latencyMs,
      aglM,
      aglSource: "rng",
      holdReason: HOLD_REASON_SEARCH_EXHAUSTED,
      holdNe: ctx.holdNe ?? roundNe(ctx.droneNed),
    };
  }

  const searching = at.state === "searching";
  const predicted = predictedBoxAt(tSec);
  const box = at.state === "reacquired" ? reacquiredBox(tSec) : predicted ?? (searching ? null : targetBox(tSec));
  const rel = box
    ? ((box.x + box.width / 2) / FRAME_WIDTH - 0.5) * CAMERA_HFOV_DEG
    : OFFFRAME_REL_DEG;
  const depression = box
    ? CAMERA_TILT_DEG + ((box.y + box.height) / FRAME_HEIGHT - 0.5) * CAMERA_VFOV_DEG
    : 14;
  const bearing = norm360(ctx.vehicleYawDeg + rel);
  const speed = round(1.3 + 0.2 * Math.sin(0.45 * tSec), 0.01);
  const range = round(10 + 1.2 * Math.sin(0.3 * tSec) + (searching ? 1.5 : 0), 0.01);
  const brgRad = (bearing * Math.PI) / 180;
  const velRad = brgRad + Math.PI / 3;
  const targetNed = roundNe([ctx.droneNed[0] + range * Math.cos(brgRad), ctx.droneNed[1] + range * Math.sin(brgRad)]);
  const vel: [number, number] = [speed * Math.cos(velRad), speed * Math.sin(velRad)];

  let confidence = 0.88;
  let sigma = 0.35;
  let rangeCues: FollowState["rangeCues"] = [
    { kind: "ground", rangeM: round(range + 0.25, 0.01), sigmaM: 0.9 },
    { kind: "box_height", rangeM: round(range - 0.35, 0.01), sigmaM: 1.3 },
    { kind: "lidar", rangeM: range, sigmaM: 0.12 },
  ];
  if (phase === "acquiring") {
    confidence = 0.8;
    sigma = 0.8;
  } else if (phase === "following" && isUncertain(at)) {
    confidence = 0.61;
  } else if (phase === "predicting") {
    confidence = round(0.88 * (1 - 0.15 * at.localS), 0.01);
    sigma = round(0.6 + 0.3 * at.localS, 0.01);
    rangeCues = [{ kind: "ground", rangeM: range, sigmaM: 1.1 }];
  } else if (phase === "searching" || phase === "repositioning") {
    confidence = 0.3;
    sigma = 2;
    rangeCues = [];
  } else if (at.state === "reacquired") {
    confidence = 0.83;
    sigma = 0.5;
  }

  const holding = phase === "holding";
  const predictedBbox: PredictedBbox | null = predicted
    ? { cameraId: ctx.cameraId, frameW: FRAME_WIDTH, frameH: FRAME_HEIGHT, x: predicted.x, y: predicted.y, w: predicted.width, h: predicted.height }
    : null;

  return {
    ...base,
    ...(isRecoveryPhase(phase) ? recovery(phase, at, ctx, targetNed, vel) : {}),
    trackId,
    confidence,
    rangeM: holding ? null : range,
    rangeSigmaM: holding ? null : sigma,
    rangeCues: holding ? [] : rangeCues,
    targetSpeedMps: speed,
    aglM: searching ? round(aglM + 0.3, 0.01) : aglM,
    aglSource: searching ? "baro" : "rng",
    pipelineLatencyMs: latencyMs,
    holdReason: holding ? HOLD_REASON_NO_RANGE : null,
    bearingDeg: round(bearing, 0.1),
    depressionDeg: round(depression, 0.1),
    targetNed,
    targetVelNed: roundNe(vel),
    predictedBbox,
  };
}

/** The recovery fields while the subject is sought: the search budget left,
 * the widening step, the search ellipse about the prediction (growing with
 * the time lost), the predicted path (0.5 s apart), the vantage point a third
 * of the way from the drone to the prediction and off to its side, and while
 * searching a trunk-sized occluder between them. */
function recovery(
  phase: FollowPhase,
  at: HudStateAt,
  ctx: FollowContext,
  targetNed: [number, number],
  vel: [number, number],
): Partial<FollowState> {
  const lostS = at.state === "searching" ? HUD_STATE_S + at.localS : at.localS;
  const headingDeg = round(norm360((Math.atan2(vel[1], vel[0]) * 180) / Math.PI), 0.1);
  const semiMajorM = round(1.5 + 0.6 * lostS, 0.01);
  const [dn, de] = [targetNed[0] - ctx.droneNed[0], targetNed[1] - ctx.droneNed[1]];
  const len = Math.hypot(dn, de) || 1;
  const vantage = roundNe([ctx.droneNed[0] + dn / 3 - (2 * de) / len, ctx.droneNed[1] + de / 3 + (2 * dn) / len]);
  const fromVantage = phase === "repositioning" || phase === "searching";
  return {
    reacquireRemainingS: round(Math.max(0, SEARCH_BUDGET_S - lostS), 0.1),
    searchBudgetS: SEARCH_BUDGET_S,
    searchStep: phase === "searching" ? Math.min(SEARCH_STEPS - 1, Math.floor(at.localS / SEARCH_STEP_S)) : null,
    searchArea: { centerNe: targetNed, semiMajorM, semiMinorM: round(semiMajorM * 0.6, 0.01), headingDeg },
    predictedPathNe: [0, 1, 2, 3].map((k) => roundNe([targetNed[0] + 0.5 * k * vel[0], targetNed[1] + 0.5 * k * vel[1]])),
    vantageNe: fromVantage ? vantage : null,
    vantageState: phase === "repositioning" ? "enroute" : phase === "searching" ? "arrived" : null,
    occluder: phase === "searching" ? { ne: roundNe([targetNed[0] - dn / (2 * len), targetNed[1] - de / (2 * len)]), kind: "narrow" } : null,
  };
}
