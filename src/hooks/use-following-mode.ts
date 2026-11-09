"use client";

/**
 * @module use-following-mode
 * @description Whether the cockpit is in following mode for a drone, plus the
 * `follow.state` it is derived from. Re-renders on the shared 1 Hz clock so
 * a report that stops arriving reads stale.
 *
 * @license GPL-3.0-only
 */

import type { FollowState } from "@/lib/hud/nav-types";
import { useClockTick } from "@/lib/agent/freshness";
import { pluginSkillId } from "@/lib/skills/plugin-skills";
import { useSkillRegistry } from "@/lib/skills";
import { isFollowingMode } from "@/lib/hud/follow-chrome";
import { FOLLOW_ME_PLUGIN_ID, useFollowStateEntry } from "@/hooks/use-nav-feed";
import { FOLLOW_STALE_MS } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { msSince } from "@/components/cockpit/band/format";

/** Registry id of the follow-me toggle skill (`gcs.contributes.skills[].id`). */
export const FOLLOW_SKILL_ID = pluginSkillId(FOLLOW_ME_PLUGIN_ID, "follow-me");

export interface FollowingModeView {
  /** Latest follow state (fresh or not), or null. */
  follow: FollowState | null;
  /** True when the follow state is older than the stale window. */
  stale: boolean;
  following: boolean;
  installed: boolean;
  designated: boolean;
}

export function useFollowingMode(droneId: string): FollowingModeView {
  useClockTick();
  const entry = useFollowStateEntry(droneId);
  const installed = useSkillRegistry((s) => s.skills.has(FOLLOW_SKILL_ID));
  const designated = useSelectedTargetStore((s) => s.designated?.droneId === droneId);

  const ageMs = entry ? msSince(entry.receivedAt) : Number.POSITIVE_INFINITY;
  const follow = entry?.data ?? null;
  return {
    follow,
    stale: ageMs > FOLLOW_STALE_MS,
    following: isFollowingMode({ phase: follow?.phase ?? null, ageMs, installed, designated }),
    installed,
    designated,
  };
}
