/**
 * @license GPL-3.0-only
 *
 * A plugin skill's confirm sheet names the skill it activates.
 */

import { describe, expect, it } from "vitest";
import { buildPluginSkill, type DroneSkillContribution } from "@/lib/skills/plugin-skills";
import type { SkillContext } from "@/lib/skills/types";
import messages from "../../../../locales/en.json";

const contribution: DroneSkillContribution = {
  installId: "i-1",
  pluginId: "com.example.follow",
  localId: "follow",
  label: "skill.follow_me",
  icon: "Sparkles",
  category: "behavior",
  toggle: true,
  confirm: true,
  armRequirement: null,
  configKey: "active",
  stateTopic: "follow.state",
};

describe("plugin skill confirm", () => {
  it("titles the sheet with the skill's name", () => {
    const skill = buildPluginSkill(contribution);
    const policy = skill.confirmFor?.(undefined, { armState: "armed" } as SkillContext);
    expect(policy?.title).toBe("skills.plugin.confirm.titleNamed");
    expect(messages.skills.plugin.confirm.titleNamed).toContain("{skill}");
    expect(skill.confirmValues?.()).toEqual({ skill: "Follow Me" });
  });
});
