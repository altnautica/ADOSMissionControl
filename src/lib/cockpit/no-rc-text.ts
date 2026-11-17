/**
 * @module cockpit/no-rc-text
 * @description The no-RC lines: what a lost link ends in when the drone flies
 * with no RC transmitter, from the pilot's reported link-loss action and
 * window, or the pilot's defaults (return home after 10 s) from an agent that
 * omits them.
 * @license GPL-3.0-only
 */

import { linkLossActionText } from "@/lib/hud/link-loss";
import { specText } from "@/lib/hud/spec-text";

/** The link-loss window the pilot uses when its state does not report one. */
export const DEFAULT_LINK_LOSS_S = 10;

interface LinkLossPosture {
  linkLossAction: string | null;
  linkLossS: number | null;
}

function postureArgs(p: LinkLossPosture): { action: string; s: number } {
  return { action: linkLossActionText(p.linkLossAction ?? "rth"), s: Math.round(p.linkLossS ?? DEFAULT_LINK_LOSS_S) };
}

/** The warning before a deliberate leave with no RC: the pilot's link-loss
 *  action follows once this surface stops talking. */
export function noRcLeaveText(p: LinkLossPosture): string {
  return specText("shell.leave_no_rc", postureArgs(p));
}

/** The no-RC posture line: what stops the drone and what a lost link ends in. */
export function noRcStripText(p: LinkLossPosture): string {
  return specText("follow.no_rc_strip", postureArgs(p));
}
