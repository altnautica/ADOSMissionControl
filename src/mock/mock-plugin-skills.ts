/**
 * @module mock-plugin-skills
 * @description Demo `flight.skill` contributions per demo drone, served in
 * demo mode in place of a real agent's skill list. Each skill comes from the
 * manifest of an install running on that drone (follow-me and the optical pod
 * on alpha-1, the thermal camera on charlie-3, the gimbal on delta-4), so the
 * picker offers exactly what the published extension declares. A label that is
 * a key into the extension's string bundle resolves to its words here, as the
 * live host does from the node.
 * @license GPL-3.0-only
 */

import type { DroneSkillContribution } from "@/lib/skills/plugin-skills";
import { demoExtensionLocale } from "./extension-locales";
import { getDemoRunningReleaseInstalls } from "./mock-plugins";

export function getDemoDroneSkillContributions(
  agentId: string,
): DroneSkillContribution[] {
  return getDemoRunningReleaseInstalls(agentId).flatMap(({ install, manifest }) => {
    const strings = demoExtensionLocale(install.pluginId);
    return (manifest.contributesSkills ?? []).map((s) => ({
      installId: install.installId,
      pluginId: install.pluginId,
      localId: s.id,
      label: strings[s.label] ?? s.label,
      icon: s.icon,
      category: s.category,
      toggle: s.toggle,
      confirm: s.confirm,
      armRequirement: s.armRequirement,
      configKey: s.activation.configKey,
      stateTopic: s.state.topic,
      defaultBinding: s.defaultBinding,
    }));
  });
}
