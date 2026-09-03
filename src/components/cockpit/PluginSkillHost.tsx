/**
 * Registers plugin-contributed flight skills for the active drone into the
 * cockpit Skill Bar registry, and seeds each skill's suggested default binding
 * into the first empty hotbar slot of the active loadout.
 *
 * The host is a render-null effect sibling of the Skill Bar. It reads the
 * per-drone `flight.skill` contributions, builds a registry Skill per
 * contribution keyed to the active drone, and registers them. On drone switch,
 * uninstall, or unmount it unregisters every skill it added (the registry
 * clean-stops an active toggle on every drone before dropping it).
 *
 * Default-binding seeding is "first empty slot wins": the suggested key /
 * gamepad button drops into the lowest-index unbound slot of the active
 * loadout, and the binding store's last-write-wins clears a colliding key /
 * button from any other slot. Seeding happens once per skill per loadout (a
 * skill already bound somewhere is left where the operator put it).
 *
 * @module fly/PluginSkillHost
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";

import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillRegistry } from "@/lib/skills";
import { buildPluginSkill } from "@/lib/skills/plugin-skills";
import {
  installPluginConfigWriter,
  uninstallPluginConfigWriter,
} from "@/lib/skills/plugin-config-writer";
import { useDroneSkillContributions } from "@/hooks/use-drone-skill-contributions";
import { usePluginSkillEgress } from "@/hooks/use-plugin-skill-egress";

export function PluginSkillHost() {
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const contributions = useDroneSkillContributions(selectedId ?? undefined);

  // Poll the selected drone's plugins for their published state over the LAN
  // and feed it to the Skill Bar store + the plugin event bus (live state ring).
  usePluginSkillEgress(selectedId);

  // Wire the live config writer for the whole skill surface: a skill toggle's
  // activate/deactivate flips the plugin's per-drone `active` through the LAN
  // agent. Installed once while the cockpit is mounted (it resolves the drone
  // per call), cleared on unmount so a skill then no-ops gracefully.
  useEffect(() => {
    installPluginConfigWriter();
    return () => uninstallPluginConfigWriter();
  }, []);

  // Track skill ids registered for the current drone so cleanup unregisters
  // exactly what this host added (and nothing the registry owns elsewhere).
  const registeredRef = useRef<string[]>([]);

  useEffect(() => {
    if (!selectedId || contributions.length === 0) {
      // Nothing to register; existing registrations are torn down by the
      // cleanup of the previous effect run.
      registeredRef.current = [];
      return;
    }

    const register = useSkillRegistry.getState().register;
    const ids: string[] = [];
    for (const contribution of contributions) {
      const skill = buildPluginSkill(contribution);
      register(skill);
      ids.push(skill.id);
      seedDefaultBinding(skill.id, contribution.defaultBinding);
    }
    registeredRef.current = ids;

    return () => {
      const unregister = useSkillRegistry.getState().unregister;
      for (const id of ids) unregister(id);
      registeredRef.current = [];
    };
    // Re-run on drone switch or when the contribution set changes; the
    // contributions array is memoized by the hook so identity is stable.
  }, [selectedId, contributions]);

  return null;
}

/**
 * Drop a skill's suggested default binding into the first empty hotbar slot of
 * the active loadout. No-op when the skill is already bound to a slot, when
 * there is no suggested binding, or when every slot is taken.
 */
function seedDefaultBinding(
  skillId: string,
  binding: { key?: string | null; gamepadButton?: number | null } | undefined,
): void {
  if (!binding) return;
  const key = binding.key ?? null;
  const gamepadButton =
    typeof binding.gamepadButton === "number" ? binding.gamepadButton : null;
  if (key === null && gamepadButton === null) return;

  const state = useSettingsStore.getState();
  const loadoutId = state.activeLoadoutId;
  const loadout = state.loadouts[loadoutId];
  if (!loadout) return;

  // Already bound somewhere: respect the operator's placement.
  if (loadout.slots.some((slot) => slot.skillId === skillId)) return;

  const empty = loadout.slots.find((slot) => slot.skillId === null);
  if (!empty) return;

  state.bindSkillToSlot(loadoutId, empty.index, skillId);
  if (key !== null) state.setSlotKey(loadoutId, empty.index, key);
  if (gamepadButton !== null) {
    state.setSlotGamepadButton(loadoutId, empty.index, gamepadButton);
  }
}
