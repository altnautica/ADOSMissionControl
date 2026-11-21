/**
 * @module hud/follow-height
 * @description The two leaf-clearance readouts beside the follow state, the
 * same words on every surface: the follow height lowered under leaves
 * (`follow.state` `height_lowered` / `height_reason`, "Flying under leaves:
 * 3.9 m" with the reason as a secondary line), and the overhead clearance the
 * pilot reports along the way ahead (`overhead_ahead`, "Overhead clearance
 * ahead: 3.9 m in 3 m"), shown only while the pilot reports one.
 *
 * @license GPL-3.0-only
 */

import type { FollowState } from "./nav-types";
import type { OverheadAhead } from "./pilot-fields";
import { specText } from "./spec-text";

export interface FollowHeightLine {
  /** `Flying under leaves: 3.9 m`. */
  text: string;
  /** Why, for a tooltip or a secondary line; null with no known reason. */
  reason: string | null;
}

/** The lowered follow height, or null while the height is the one set. */
export function followHeightLine(f: FollowState | null): FollowHeightLine | null {
  if (!f?.heightLowered || f.heightSetpointM === null) return null;
  return {
    text: specText("follow.height_lowered", { v: f.heightSetpointM.toFixed(1) }),
    reason: f.heightReason ? specText(`follow.height_reason.${f.heightReason}`) : null,
  };
}

/** `Overhead clearance ahead: 3.9 m in 3 m`, or null while nothing lies
 *  overhead along the way. */
export function overheadAheadLine(o: OverheadAhead | null): string | null {
  if (!o) return null;
  return specText("pilot.overhead_ahead", { h: o.flyUnderAglM.toFixed(1), d: String(Math.round(o.aheadM)) });
}
