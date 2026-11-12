/**
 * A skill's display name: a built-in the cockpit spec lists takes the spec's
 * name; an extension's skill label resolves in the extension's own locale
 * bundle, and a key nothing resolves is humanized, never shown raw.
 *
 * @license GPL-3.0-only
 */
import { afterEach, describe, expect, it } from "vitest";

import { specBuiltin } from "@/lib/cockpit/spec-builtins";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { usePluginSkillStrings } from "@/lib/skills/plugin-skill-strings";
import type { Skill } from "@/lib/skills/types";

/** An app translator with nothing in it, as next-intl's `has` reports. */
const empty = Object.assign((key: string) => `app:${key}`, { has: () => false });

const plugin = (label: string) =>
  ({ id: "com.example.pod:rf", label, source: "plugin", pluginId: "com.example.pod" }) as unknown as Skill;

afterEach(() => usePluginSkillStrings.setState({ byPlugin: {} }));

describe("skill display label", () => {
  it("names a spec built-in by the spec", () => {
    const rth = { id: "rth", label: "skills.rth", source: "builtin" } as unknown as Skill;
    expect(skillDisplayLabel(rth, empty)).toBe(specBuiltin("rth").label);
  });

  it("resolves an extension label in its own bundle", () => {
    usePluginSkillStrings.getState().set("com.example.pod", { "skill.fireRangefinder": "Fire rangefinder" });
    expect(skillDisplayLabel(plugin("skill.fireRangefinder"), empty)).toBe("Fire rangefinder");
  });

  it("humanizes a key no bundle carries rather than showing it raw", () => {
    expect(skillDisplayLabel(plugin("skill.fire_rangefinder"), empty)).toBe("Fire Rangefinder");
  });

  it("keeps a literal label as written", () => {
    expect(skillDisplayLabel(plugin("Track target"), empty)).toBe("Track target");
  });
});
