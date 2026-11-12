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

import type { PilotState } from "@/lib/hud/cockpit-frames";
import type { FollowState } from "@/lib/hud/nav-types";
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

/** Flight-controller modes that accept guided setpoints (ArduPilot GUIDED,
 * GUIDED_NOGPS; PX4 OFFBOARD). */
const GUIDED_MODES: Record<string, true> = { GUIDED: true, GUIDED_NOGPS: true, OFFBOARD: true };

export type FollowMeLockState = "locked" | "uncertain" | "lost";

export type FollowMeHoldReason =
  | "inactive"
  | "no-lock"
  | "lock-uncertain"
  | "lock-lost"
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
    // A lost lock is dropped: the operator designates again.
    case "lost":
      return held("lock-lost", "lost", null);
    // Designated but not yet locked, or searching past the coast window.
    case "acquiring":
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
  // Following, or coasting on the last commanded setpoint.
  return {
    active: true,
    lock_state: "locked",
    target_id: target,
    range_m: follow.rangeM,
    distance_setpoint_m: distanceM,
    height_setpoint_m: heightM,
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
