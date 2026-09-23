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
 * Default-binding seeding is "first empty slot, once": the skill drops into the
 * lowest-index empty slot of the active loadout, taking the suggested key /
 * gamepad button only when the cockpit does not reserve it and no other slot
 * holds it. Each loadout records the skills it was offered, so a slot the
 * operator later clears stays cleared (see `seedSuggestedBinding`).
 *
 * @module fly/PluginSkillHost
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";

import { useDroneManager } from "@/stores/drone-manager";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
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
  // Plugin install rows and the LAN plugin client are keyed by the node's
  // bare device id, not the `node:<deviceId>` selection id.
  const pluginDeviceId = selectedId
    ? (deviceIdFromNodeId(selectedId) ?? selectedId)
    : null;
  const contributions = useDroneSkillContributions(pluginDeviceId ?? undefined);

  // Poll the selected drone's plugins for their published state over the LAN
  // and feed it to the Skill Bar store + the plugin event bus (live state ring).
  usePluginSkillEgress(pluginDeviceId);

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
        if (contribution.defaultBinding) {
          const settings = useSettingsStore.getState();
          settings.seedSuggestedBinding(
            settings.activeLoadoutId,
            skill.id,
            contribution.defaultBinding,
          );
        }
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
