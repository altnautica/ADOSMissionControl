/**
 * Registers plugin-contributed flight skills for the active drone into the
 * cockpit Skill Bar registry, and seeds each skill's suggested default binding
 * into the first empty hotbar slot of the active loadout.
 *
 * The host is a render-null effect sibling of the Skill Bar. It reads the
 * per-drone `flight.skill` contributions, builds a registry Skill per
 * contribution, and registers them. Registrations are diffed by skill id: a
 * changed definition re-registers in place and only ids that disappeared are
 * dropped. Dropping a skill on drone switch or host unmount never commands a
 * vehicle (a behavior keeps running on the drone it was started on); only a
 * skill that vanishes from the same drone's resolved list (uninstalled or its
 * grant revoked) is clean-stopped on that drone.
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

  // Skill ids registered by this host and the drone they were resolved for, so
  // a re-run diffs against exactly what this host added.
  const registeredRef = useRef<{ droneId: string | null; ids: Set<string> }>({
    droneId: null,
    ids: new Set(),
  });

  useEffect(() => {
    const registry = useSkillRegistry.getState();
    const prev = registeredRef.current;
    const droneId = selectedId ?? null;
    const sameDrone = droneId !== null && prev.droneId === droneId;

    // Same drone, source still resolving: keep what is registered.
    if (sameDrone && contributions === null) return;

    const next = new Set<string>();
    if (droneId !== null && contributions !== null) {
      for (const contribution of contributions) {
        const skill = buildPluginSkill(contribution);
        registry.register(skill);
        next.add(skill.id);
        seedDefaultBinding(skill.id, contribution.defaultBinding);
      }
    }

    for (const id of prev.ids) {
      if (next.has(id)) continue;
      registry.unregister(id, sameDrone ? { deactivateOn: droneId } : undefined);
    }
    registeredRef.current = { droneId, ids: next };
  }, [selectedId, contributions]);

  // Host teardown drops the registrations without commanding any vehicle.
  useEffect(
    () => () => {
      const registry = useSkillRegistry.getState();
      for (const id of registeredRef.current.ids) registry.unregister(id);
      registeredRef.current = { droneId: null, ids: new Set() };
    },
    [],
  );

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
