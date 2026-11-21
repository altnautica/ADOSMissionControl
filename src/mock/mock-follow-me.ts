/**
 * @module mock/mock-follow-me
 * @description Demo stand-in for the Follow-Me extension's node tab
 * (`com.altnautica.follow-me`, panel `follow-me-tab`, at the published release
 * in `extension-manifests.ts`). The extension ships the tab as a signed iframe
 * bundle that demo mode cannot load, so the demo mounts an in-memory inline
 * module under the host's native parameter controls, as the iframe mounts on
 * a live node.
 *
 * The tab's Live section reads the extension's `follow.state` read-back. The
 * demo derives that read-back from the demo follow feed (the scripted HUD
 * cycle in `mock-hud-script`) and the demo pilot, through the same gate the
 * extension's follow loop applies in order: follow off, no lock, lock lost,
 * lock uncertain, flight controller heartbeat stale, disarmed, not guided, no
 * ground fix, then commanding.
 *
 * @license GPL-3.0-only
 */

import type { OverheadAhead, PilotState } from "@/lib/hud/cockpit-frames";
import type { FollowHeightReason, FollowState } from "@/lib/hud/nav-types";
import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import { demoInlineTab } from "./demo-inline-tab";
import { FOLLOW_ME } from "./extension-manifests";

export const FOLLOW_ME_PANEL_ID = "follow-me-tab";

/** The extension reads the flight controller as stale once its heartbeat is
 * older than this. */
export const FOLLOW_FC_MAX_AGE_MS = 3000;

/** How often the tab re-derives the read-back, so a stale input ages out. */
export const FOLLOW_ME_REFRESH_MS = 500;

/** A tracked subject below this confidence is uncertain to the tracker. */
const UNCERTAIN_BELOW = 0.7;

/** The least follow height over a ground subject: a 2.0 m body, 0.4 m of
 * rotor and 1.0 m of clearance. A lower setting is raised to it. */
export const FOLLOW_MIN_HEIGHT_M = 3.4;

/** The least follow distance on a camera's range alone (σ 0.5 m or more);
 * the demo models no measured range. A shorter setting is flown at it. */
export const FOLLOW_MIN_STANDOFF_M = 5;

/** Why a shorter follow distance is flown farther, as the extension names it. */
export type FollowMeStandoffReason = "camera-range" | "range-unknown" | "subject-standing" | "closing-in";

/** Flight-controller modes that accept guided setpoints (ArduPilot GUIDED,
 * GUIDED_NOGPS; PX4 OFFBOARD). */
const GUIDED_MODES: Record<string, true> = { GUIDED: true, GUIDED_NOGPS: true, OFFBOARD: true };

export type FollowMeLockState = "locked" | "uncertain" | "lost";

export type FollowMeHoldReason =
  | "inactive"
  | "no-lock"
  | "lock-uncertain"
  | "awaiting-operator"
  | "pose-stale"
  | "fc-stale"
  | "fc-disarmed"
  | "fc-not-guided"
  | "no-ground-fix";

/** The extension's `follow.state` read-back, snake_case as its agent emits it. */
export interface FollowMeReadback {
  active: boolean;
  lock_state: FollowMeLockState | null;
  target_id: number | null;
  range_m: number | null;
  distance_setpoint_m: number | null;
  height_setpoint_m: number | null;
  /** True when the setpoint was raised to the head-height floor. */
  height_raised: boolean;
  /** True when the height flown is lower than the one set, under the leaves
   * the pilot reports ahead (`overhead_ahead`). */
  height_lowered: boolean;
  /** Why: `canopy` under the leaves, `canopy_floor` held at the head-height
   * floor with the leaves lower still; null when not lowered by leaves. */
  height_reason: FollowHeightReason | null;
  /** The shortest follow distance flown on the range the follow has. */
  standoff_min_m: number | null;
  /** True when the set distance was shorter and is held at the minimum. */
  standoff_raised: boolean;
  /** Why it is held there; null when it is not. */
  standoff_reason: FollowMeStandoffReason | null;
  commanding: boolean;
  fc_armed: boolean;
  fc_guided: boolean;
  hold_reason: FollowMeHoldReason | null;
}

export interface FollowMeReadbackInputs {
  /** The demo follow feed's latest frame, or null while the skill is off. */
  follow: FollowState | null;
  /** The demo pilot's latest state, with its age at the read time. */
  pilot: { state: PilotState; ageMs: number } | null;
  /** The per-drone follow distance and height settings. */
  distanceM: number;
  heightM: number;
}

/**
 * The follow height flown under the leaves the pilot reports ahead, as the
 * extension lowers it: to the fly-under height, never under the head-height
 * floor (held there, `canopy_floor`, when the leaves are lower still).
 */
export function underLeaves(
  setM: number,
  overhead: OverheadAhead | null,
): { heightM: number; lowered: boolean; reason: FollowHeightReason | null } {
  const ceiling = overhead?.flyUnderAglM ?? null;
  if (ceiling === null || ceiling >= setM) return { heightM: setM, lowered: false, reason: null };
  if (ceiling >= FOLLOW_MIN_HEIGHT_M) return { heightM: ceiling, lowered: true, reason: "canopy" };
  return { heightM: FOLLOW_MIN_HEIGHT_M, lowered: setM > FOLLOW_MIN_HEIGHT_M, reason: "canopy_floor" };
}

/**
 * The `follow.state` read-back the extension would publish for the demo
 * follow feed. The flight-controller flags are aged, not remembered: a pilot
 * report older than the heartbeat window reads disarmed and not guided, and
 * holds as `fc-stale`. Range and setpoints are reported only while
 * commanding.
 */
export function demoFollowReadback({ follow, pilot, distanceM, heightM }: FollowMeReadbackInputs): FollowMeReadback {
  const fcFresh = pilot !== null && pilot.ageMs <= FOLLOW_FC_MAX_AGE_MS;
  const fcArmed = fcFresh && pilot.state.armed === true;
  const fcGuided = fcFresh && GUIDED_MODES[pilot.state.fcModeName ?? ""] === true;
  const held = (
    hold: FollowMeHoldReason,
    lock: FollowMeLockState | null,
    targetId: number | null,
  ): FollowMeReadback => ({
    active: follow !== null,
    lock_state: lock,
    target_id: targetId,
    range_m: null,
    distance_setpoint_m: null,
    height_setpoint_m: null,
    height_raised: false,
    height_lowered: false,
    height_reason: null,
    standoff_min_m: null,
    standoff_raised: false,
    standoff_reason: null,
    commanding: false,
    fc_armed: fcArmed,
    fc_guided: fcGuided,
    hold_reason: hold,
  });

  if (follow === null) return held("inactive", null, null);
  const target = follow.trackId;
  switch (follow.phase) {
    case "idle":
      return held("no-lock", null, null);
    // The lock is lost and follow-me holds for the operator.
    case "holding-await-operator":
      return held("awaiting-operator", "lost", null);
    // Designated but not yet locked, or seeking the subject from the vantage
    // point.
    case "acquiring":
    case "repositioning":
    case "searching":
      return held("lock-uncertain", "uncertain", target);
  }
  if (follow.phase === "following" && (follow.confidence ?? 0) < UNCERTAIN_BELOW) {
    return held("lock-uncertain", "uncertain", target);
  }
  if (!fcFresh) return held("fc-stale", "locked", target);
  if (!fcArmed) return held("fc-disarmed", "locked", target);
  if (!fcGuided) return held("fc-not-guided", "locked", target);
  // Holding: the subject is locked but no ground point resolves.
  if (follow.phase === "holding" || follow.rangeM === null) return held("no-ground-fix", "locked", target);
  // Following, or predicting on the last commanded setpoint.
  const standoffRaised = distanceM < FOLLOW_MIN_STANDOFF_M;
  const height = underLeaves(Math.max(heightM, FOLLOW_MIN_HEIGHT_M), pilot?.state.overheadAhead ?? null);
  return {
    active: true,
    lock_state: "locked",
    target_id: target,
    range_m: follow.rangeM,
    distance_setpoint_m: Math.max(distanceM, FOLLOW_MIN_STANDOFF_M),
    height_setpoint_m: height.heightM,
    height_raised: heightM < FOLLOW_MIN_HEIGHT_M,
    height_lowered: height.lowered,
    height_reason: height.reason,
    standoff_min_m: FOLLOW_MIN_STANDOFF_M,
    standoff_raised: standoffRaised,
    standoff_reason: standoffRaised ? "camera-range" : null,
    commanding: true,
    fc_armed: true,
    fc_guided: true,
    hold_reason: null,
  };
}

/** The inline module the demo mounts in place of the extension's bundle. The
 * React panel is imported on mount, not at module load: the plugin
 * contribution producer imports this file on every route. */
export const DEMO_FOLLOW_ME_MODULE: InlinePluginModule = {
  async mount(root, host) {
    const { mountFollowMeDemoPanel } = await import("./follow-me-demo-panel");
    return mountFollowMeDemoPanel(root, host);
  },
};

/** The demo Follow-Me tab body for a drone, or null when that demo drone does
 * not run the extension. */
export const getDemoFollowMeContribution = demoInlineTab(FOLLOW_ME, FOLLOW_ME_PANEL_ID, DEMO_FOLLOW_ME_MODULE);
