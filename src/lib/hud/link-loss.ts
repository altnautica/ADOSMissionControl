// The link-loss countdown line: what the pilot does when the surface link
// stays lost, and in how long. The action reads through the spec's
// `pilot.link_loss_action.<action>` (rth and rtl read "Return home", hold and
// loiter "Hold", land "Land"); an agent that reports no action, or one this
// spec does not name, gets a dash rather than a guessed "Return home".

import { hasSpecText, specText } from "./spec-text";

/** The text of a link-loss action, or a dash. */
export function linkLossActionText(action: string | null | undefined): string {
  const key = `pilot.link_loss_action.${action ?? ""}`;
  return action && hasSpecText(key) ? specText(key) : "—";
}

/** The countdown line, or null with no countdown running. */
export function linkLossLine(p: { linkLossInS: number | null; linkLossAction: string | null }): string | null {
  if (p.linkLossInS === null) return null;
  return specText("flow.link_loss.countdown", { action: linkLossActionText(p.linkLossAction), in_s: Math.ceil(p.linkLossInS) });
}
