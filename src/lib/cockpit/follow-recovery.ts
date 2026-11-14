/**
 * @module cockpit/follow-recovery
 * @description Follow-me recovery in the cockpit: the recovery line the range
 * panel shows while the subject is sought, and the waiting prompt's actions
 * with their transports. Which prompt shows, and which actions it offers, is
 * the shared rule (`hud/follow-prompt`); this module only runs the actions:
 *
 * - `resume` writes the next `operator_resume_seq` to the follow-me config;
 * - `redesignate` drops the designation, so the next box picked on the video
 *   designates afresh and follow-me re-locks on it;
 * - `rth` and `land` dispatch the built-ins (the pilot's `rth` / `land` while
 *   the pilot flies, as every other surface sends them);
 * - `stop` writes `active = false` to the follow-me config.
 *
 * Keys: R search again, P pick, H home, L land, X stop. They answer only while
 * the prompt has focus and only without a modifier: the built-ins own the
 * modified chords and a plugin may bind a bare letter globally, so the prompt
 * never takes a key from the window. The transports are injected, so every
 * route is unit-tested. Pure.
 *
 * @license GPL-3.0-only
 */

import { specString } from "@/lib/cockpit/spec-strings";
import type { FollowPromptAction } from "@/lib/hud/follow-prompt";
import { isRecoveryPhase, type FollowState } from "@/lib/hud/nav-types";

/**
 * `18 s · step 2 · On the way · Behind a trunk or column` while the subject is
 * sought (seconds left of the search budget, the widening step while
 * searching, the vantage state, what hides the subject), else null.
 */
export function followRecoveryLine(f: FollowState): string | null {
  if (!isRecoveryPhase(f.phase)) return null;
  const parts = [
    f.reacquireRemainingS !== null ? `${Math.max(0, Math.ceil(f.reacquireRemainingS))} s` : null,
    f.phase === "searching" && f.searchStep !== null ? `step ${f.searchStep + 1}` : null,
    f.vantageState ? specString(`follow.vantage.${f.vantageState}`) : null,
    f.occluder ? specString(`follow.occluder.${f.occluder.kind}`) : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface FollowActionResult {
  ok: boolean;
  err?: string;
}

export interface FollowActionDeps {
  /** Write one follow-me config key; resolves false when it cannot reach the
   *  drone. */
  put: (key: string, value: unknown) => Promise<boolean>;
  /** Dispatch a flight built-in (`rth`, `land`). */
  flight: (skillId: "rth" | "land") => Promise<void>;
  /** Arm the pick-a-target mode. */
  startPick: () => void;
  /** The `operator_resume_seq` follow-me last reported. */
  seq: number;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function write(d: FollowActionDeps, key: string, value: unknown): Promise<FollowActionResult> {
  try {
    return (await d.put(key, value)) ? { ok: true } : { ok: false, err: specString("alert.agent_unreachable") };
  } catch (e) {
    return { ok: false, err: errText(e) };
  }
}

/** Run one prompt action through its transport. Never rejects. */
export async function runFollowAction(action: FollowPromptAction, d: FollowActionDeps): Promise<FollowActionResult> {
  switch (action) {
    case "resume":
      return write(d, "operator_resume_seq", d.seq + 1);
    case "redesignate":
      d.startPick();
      return { ok: true };
    case "rth":
    case "land":
      try {
        await d.flight(action);
        return { ok: true };
      } catch (e) {
        return { ok: false, err: errText(e) };
      }
    case "stop":
      return write(d, "active", false);
  }
}

export const FOLLOW_ACTION_KEYS: Readonly<Record<FollowPromptAction, string>> = {
  resume: "r",
  redesignate: "p",
  rth: "h",
  land: "l",
  stop: "x",
};

/** The offered action a bare key names, or null (any modifier, or a key of an
 *  action the prompt does not offer). */
export function followActionForKey(
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  offered: readonly FollowPromptAction[],
): FollowPromptAction | null {
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
  const key = e.key.toLowerCase();
  return offered.find((a) => FOLLOW_ACTION_KEYS[a] === key) ?? null;
}
