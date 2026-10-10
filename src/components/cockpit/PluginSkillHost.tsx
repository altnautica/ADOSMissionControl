/**
 * Registers extension-contributed flight skills for the cockpit's drone into
 * the Skill Bar registry, and seeds each skill's suggested default binding
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
 * holds it. A suggested binding that collides is left unbound and the operator
 * is told which skills need a binding. Each loadout records the skills it was
 * offered, so a slot the operator later clears stays cleared (see
 * `seedSuggestedBinding`).
 *
 * @module cockpit/PluginSkillHost
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillRegistry } from "@/lib/skills";
import { buildPluginSkill } from "@/lib/skills/plugin-skills";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import {
  installPluginConfigWriter,
  uninstallPluginConfigWriter,
} from "@/lib/skills/plugin-config-writer";
import { useDroneSkillContributions } from "@/hooks/use-drone-skill-contributions";
import { usePluginSkillEgress } from "@/hooks/use-plugin-skill-egress";
import { useToast } from "@/components/ui/toast";

export function PluginSkillHost({ droneId }: { droneId: string }) {
  const t = useTranslations();
  const { toast } = useToast();
  // Plugin install rows and the LAN plugin client are keyed by the node's
  // bare device id, not the `node:<deviceId>` node id.
  const pluginDeviceId = droneId ? (deviceIdFromNodeId(droneId) ?? droneId) : null;
  const contributions = useDroneSkillContributions(pluginDeviceId ?? undefined);

  // Poll the drone's extensions for their published state over the LAN and
  // feed it to the Skill Bar store + the extension event bus (live state ring).
  usePluginSkillEgress(pluginDeviceId);

  // Wire the live config writer for the whole skill surface: a skill toggle's
  // activate/deactivate flips the extension's per-drone `active` through the
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

  // The latest translator + toast, read inside the registration effect without
  // making a locale or provider change re-run it.
  const feedbackRef = useRef({ t, toast });
  useEffect(() => {
    feedbackRef.current = { t, toast };
  }, [t, toast]);

  useEffect(() => {
    const registry = useSkillRegistry.getState();
    const prev = registeredRef.current;
    const target = droneId || null;
    const sameDrone = target !== null && prev.droneId === target;

    // Same drone, source still resolving: keep what is registered.
    if (sameDrone && contributions === null) return;

    const next = new Set<string>();
    const unbound: string[] = [];
    if (target !== null && contributions !== null) {
      for (const contribution of contributions) {
        const skill = buildPluginSkill(contribution);
        registry.register(skill);
        next.add(skill.id);
        if (contribution.defaultBinding) {
          const settings = useSettingsStore.getState();
          const outcome = settings.seedSuggestedBinding(
            settings.activeLoadoutId,
            skill.id,
            contribution.defaultBinding,
          );
          if (outcome === "unbound") {
            unbound.push(skillDisplayLabel(skill, feedbackRef.current.t));
          }
        }
      }
    }

    for (const id of prev.ids) {
      if (next.has(id)) continue;
      registry.unregister(id, sameDrone ? { deactivateOn: target } : undefined);
    }
    registeredRef.current = { droneId: target, ids: next };

    if (unbound.length > 0) {
      const { t: translate, toast: notify } = feedbackRef.current;
      notify(
        translate("extensions.bindings.unbound", { skills: unbound.join(", ") }),
        "warning",
      );
    }
  }, [droneId, contributions]);

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
