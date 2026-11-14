"use client";

/**
 * @module cockpit/flight/FollowAwaitPrompt
 * @description The waiting-for-instructions prompt: while follow-me holds at
 * its latched point for the operator (`holding-await-operator`), a banner
 * under the follow strip names why and offers the actions the shared
 * `followPrompt` rule allows: search again, pick a target, return home, land,
 * stop following. Modal-free, so the video and the columns stay live. It
 * never takes focus on its own: R, P, H, L and X answer only once the
 * operator has put focus inside it (a click, Tab), so a key pressed anywhere
 * else reaches its own binding untouched. Return home and land run the same
 * bound built-ins as the left column (hold to confirm, fresh link, armed).
 * Pick a target keeps the designation until the new pick replaces it, so
 * the lock chip keeps reading "Waiting for you". A stale follow report shows
 * no prompt.
 *
 * @license GPL-3.0-only
 */

import type { KeyboardEvent } from "react";

import { useToast } from "@/components/ui/toast";
import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { useFollowingMode } from "@/hooks/use-following-mode";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import {
  FOLLOW_ACTION_KEYS,
  followActionForKey,
  runFollowAction,
  type FollowActionDeps,
} from "@/lib/cockpit/follow-recovery";
import { specString } from "@/lib/cockpit/spec-strings";
import { followPrompt, type FollowPromptAction } from "@/lib/hud/follow-prompt";
import { activateBound, buildSkillContext } from "@/lib/skills";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";

/** The live transports for a drone's prompt actions. */
export function followActionDeps(droneId: string, seq: number, onPick: () => void): FollowActionDeps {
  return {
    put: (key, value) =>
      writePluginConfigValue({
        droneId: deviceIdFromNodeId(droneId) ?? droneId,
        pluginId: FOLLOW_ME_PLUGIN_ID,
        key,
        value,
      }),
    flight: (skillId) => activateBound(skillId, buildSkillContext(droneId)),
    startPick: onPick,
    seq,
  };
}

export function FollowAwaitPrompt({ droneId }: { droneId: string }) {
  const { follow, stale } = useFollowingMode(droneId);
  const { toast } = useToast();

  const prompt = follow && !stale ? followPrompt(follow) : null;
  const seq = follow?.operatorResumeSeq ?? 0;

  if (!prompt) return null;

  const run = (action: FollowPromptAction) => {
    const deps = followActionDeps(droneId, seq, () => toast(specString("follow.prompt.action.redesignate"), "info"));
    void runFollowAction(action, deps).then((r) => {
      if (!r.ok) toast(`${specString(`follow.prompt.action.${action}`)}: ${r.err ?? ""}`, "warning");
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.repeat) return;
    const action = followActionForKey(e, prompt.actions);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    run(action);
  };

  return (
    <div
      role="alert"
      aria-labelledby="follow-prompt-title"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="fs-sheet fs-follow-prompt"
      data-zone="follow_prompt"
      data-testid="follow-await-prompt"
    >
      <div className="fs-follow-prompt-text">
        <b id="follow-prompt-title">{specString(prompt.titleKey)}</b>
        <span>{specString(prompt.bodyKey)}</span>
      </div>
      <div className="fs-follow-prompt-actions">
        {prompt.actions.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => run(a)}
            aria-keyshortcuts={FOLLOW_ACTION_KEYS[a].toUpperCase()}
            data-action={a}
            className={a === "stop" ? "tone-crit" : undefined}
          >
            <span>{specString(`follow.prompt.action.${a}`)}</span>
            <kbd aria-hidden="true">{FOLLOW_ACTION_KEYS[a].toUpperCase()}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
