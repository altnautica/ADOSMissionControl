/**
 * @module hud/follow-prompt
 * @description The operator prompt while follow-me holds and waits for
 * instructions (`holding-await-operator`): its title, a reason-specific body
 * and the actions offered, all as `setup-strings.json` keys. Every surface
 * (cockpit, kiosk, dashboard, Mission Control, Android, the TUI) renders the
 * same rule; `fixtures/follow-prompt-cases.json` is the shared test table.
 *
 * Action transport: `resume` writes `operator_resume_seq + 1` to the follow-me
 * config; `redesignate` is the click-a-box designate flow; `rth` and `land` go
 * to the pilot; `stop` writes `active = false`.
 *
 * @license GPL-3.0-only
 */

import type { FollowState } from "./nav-types";

export type FollowPromptAction = "resume" | "redesignate" | "rth" | "land" | "stop";

/** Every action, in the order a prompt lists them. */
export const FOLLOW_PROMPT_ACTIONS: readonly FollowPromptAction[] = ["resume", "redesignate", "rth", "land", "stop"];

export interface FollowPrompt {
  titleKey: "follow.prompt.await_title";
  bodyKey: `follow.prompt.await_body.${string}`;
  actions: readonly FollowPromptAction[];
}

/** The body for each hold reason the follow waits with; any other reason
 * reads as a lost lock. */
const BODY: Readonly<Record<string, FollowPrompt["bodyKey"]>> = {
  "awaiting-operator": "follow.prompt.await_body.lock_lost",
  "search-exhausted": "follow.prompt.await_body.search_exhausted",
  "predictive-search-off": "follow.prompt.await_body.predictive_search_off",
  "no-range": "follow.prompt.await_body.no_range",
  "camera-lost": "follow.prompt.await_body.camera_lost",
};

/** Hold reasons a resumed search cannot work from: no prediction left
 * (`no-range`), or no frames to search in (`camera-lost`). */
const NO_RESUME: readonly string[] = ["no-range", "camera-lost"];

/**
 * The prompt for a follow state; null in every phase but
 * `holding-await-operator`. Resume is not offered in strict re-acquire (a
 * resumed search gives up again at once), when there is no prediction left
 * to search from (`no-range`), nor while the follow camera sends no frames
 * (`camera-lost`).
 */
export function followPrompt(s: FollowState): FollowPrompt | null {
  if (s.phase !== "holding-await-operator") return null;
  const canResume = s.reacquireMode !== "strict" && !NO_RESUME.includes(s.holdReason ?? "");
  return {
    titleKey: "follow.prompt.await_title",
    bodyKey: BODY[s.holdReason ?? ""] ?? "follow.prompt.await_body.lock_lost",
    actions: canResume ? FOLLOW_PROMPT_ACTIONS : FOLLOW_PROMPT_ACTIONS.filter((a) => a !== "resume"),
  };
}
