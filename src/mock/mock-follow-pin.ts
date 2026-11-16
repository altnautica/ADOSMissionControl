/**
 * @module mock/mock-follow-pin
 * @description A demo pin that holds the scripted follow in one phase
 * (`pin({ follow: { phase } })`): the moment of the cycle that shows the
 * phase, and the pin's agent fields laid over the scripted follow report.
 * @license GPL-3.0-only
 */

import { parseFollowState, type FollowPhase, type FollowState } from "@/lib/hud/nav-types";
import { HUD_STATE_S, HUD_STATES, type HudDemoState } from "./mock-hud-script";

/** A representative moment of the first cycle that shows `phase`, for a demo
 * pin that holds the follow in one phase. */
export function pinnedCycleS(phase: FollowPhase): number {
  const at = (state: HudDemoState, localS: number) => HUD_STATES.indexOf(state) * HUD_STATE_S + localS;
  switch (phase) {
    case "idle":
      return at("tracked", 1.5);
    case "acquiring":
      return at("locked", 3.5);
    case "following":
      return at("following", 0.5);
    case "holding":
      return at("following", 3.5);
    case "predicting":
      return at("predicting", 1.5);
    case "repositioning":
      return at("searching", 0.5);
    case "searching":
      return at("searching", 1.5);
    case "holding-await-operator":
      return at("awaiting", 1.5);
  }
}

/** A follow state on the agent's wire (snake_case), so a demo pin can lay
 * agent fields over it. */
function followWire(f: FollowState): Record<string, unknown> {
  return {
    active: f.active,
    phase: f.phase,
    track_id: f.trackId,
    confidence: f.confidence,
    range_m: f.rangeM,
    range_sigma_m: f.rangeSigmaM,
    range_cues: f.rangeCues.map((c) => ({ kind: c.kind, range_m: c.rangeM, sigma_m: c.sigmaM })),
    target_speed_mps: f.targetSpeedMps,
    agl_m: f.aglM,
    agl_source: f.aglSource,
    reacquire_mode: f.reacquireMode,
    reacquire_remaining_s: f.reacquireRemainingS,
    search_budget_s: f.searchBudgetS,
    search_step: f.searchStep,
    search_area: f.searchArea && {
      center_ne: f.searchArea.centerNe,
      semi_major_m: f.searchArea.semiMajorM,
      semi_minor_m: f.searchArea.semiMinorM,
      heading_deg: f.searchArea.headingDeg,
    },
    predicted_path_ne: f.predictedPathNe,
    vantage_ne: f.vantageNe,
    vantage_state: f.vantageState,
    occluder: f.occluder,
    hold_ne: f.holdNe,
    uncertain_mode: f.uncertainMode,
    predictive_search: f.predictiveSearch,
    operator_resume_seq: f.operatorResumeSeq,
    outpaced: f.outpaced,
    speed_limit_mps: f.speedLimitMps,
    pipeline_latency_ms: f.pipelineLatencyMs,
    hold_reason: f.holdReason,
    bearing_deg: f.bearingDeg,
    depression_deg: f.depressionDeg,
    target_ned: f.targetNed,
    target_vel_ned: f.targetVelNed,
    predicted_bbox: f.predictedBbox && {
      camera_id: f.predictedBbox.cameraId,
      frame_w: f.predictedBbox.frameW,
      frame_h: f.predictedBbox.frameH,
      x: f.predictedBbox.x,
      y: f.predictedBbox.y,
      w: f.predictedBbox.w,
      h: f.predictedBbox.h,
    },
  };
}

/** The phase a demo follow pin holds, or null when the pin names none. */
export function pinnedFollowPhase(pin: Record<string, unknown> | null): FollowPhase | null {
  if (!pin) return null;
  return parseFollowState({ phase: pin.phase })?.phase ?? null;
}

/** `f` with a demo pin's agent fields (snake_case, as `follow.state` carries
 * them) laid over it. */
export function applyFollowPin(f: FollowState, pin: Record<string, unknown>): FollowState {
  return parseFollowState({ ...followWire(f), ...pin }) ?? f;
}
