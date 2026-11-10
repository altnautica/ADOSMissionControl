/**
 * React hooks over the binding resolver. `useBoundSkillResolver` maps a bound
 * skill id to the skill it fires right now, re-rendering when the arm state or
 * flight mode changes; `useSkillChord` names the chord that fires a skill in
 * the operator's active loadout, so a tooltip never shows a stale or wrong
 * hotkey after a rebind.
 *
 * @module skills/use-skill-chord
 * @license GPL-3.0-only
 */

"use client";

import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useCallback, useMemo } from "react";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_LOADOUT_ID } from "@/stores/settings/keybindings-slice";
import { resolveBoundSkillId } from "./bound-skill";
import { formatChord } from "./chord";

/**
 * A resolver for `droneId` (the selected drone when omitted) that tracks the
 * live arm state and flight mode.
 */
export function useBoundSkillResolver(droneId?: string | null): (skillId: string) => string {
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const target = droneId ?? selectedId;
  const armState = useDroneStore((s) => s.armState);
  const missionState = useMissionStatus(target)?.state ?? null;

  return useCallback(
    (skillId: string) => resolveBoundSkillId(skillId, armState, { missionState, droneId: target }),
    [armState, missionState, target],
  );
}

/**
 * The display chord (for example "⇧A") of the active-loadout slot that fires
 * `skillId` now, or null when none does. A slot bound to `arm` counts for
 * `disarm`, and a slot bound to `pause` counts for `resume` only while a
 * mission is paused, because that is when the press resumes it.
 */
export function useSkillChord(skillId: string): string | null {
  const resolve = useBoundSkillResolver();
  const loadout = useSettingsStore(
    (s) => s.loadouts[s.activeLoadoutId] ?? s.loadouts[DEFAULT_LOADOUT_ID],
  );
  return useMemo(() => {
    const slots = loadout?.slots ?? [];
    const direct = slots.find((s) => s.key && s.skillId === skillId);
    // Disarm is reachable from an arm slot whenever it is fireable at all,
    // so its chord is shown even while the vehicle is still disarmed.
    const bound =
      direct ??
      slots.find(
        (s) =>
          s.key &&
          s.skillId !== null &&
          (resolve(s.skillId) === skillId ||
            (s.skillId === "arm" && skillId === "disarm")),
      );
    return bound?.key ? formatChord(bound.key) : null;
  }, [loadout, skillId, resolve]);
}
