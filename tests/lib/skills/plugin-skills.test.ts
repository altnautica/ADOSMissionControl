/**
 * Tests for plugin-contributed flight skills: parsing a `flight.skill`
 * contribution from a fake plugin manifest, building a registry Skill from it,
 * registering it so it resolves for a drone, activating it to flip the
 * plugin's per-drone config, and reading its state from the cached plugin
 * event.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import {
  buildPluginSkill,
  mapSkillCategory,
  pluginSkillId,
  type DroneSkillContribution,
} from "@/lib/skills/plugin-skills";
import {
  usePluginSkillHostStore,
  type PluginConfigWriter,
} from "@/lib/skills/plugin-skill-host-store";
import { useSkillRegistry } from "@/lib/skills/registry";
import { useDroneManager } from "@/stores/drone-manager";
import { buildSkillContext, activate } from "@/lib/skills";
import type { SkillContext } from "@/lib/skills/types";

/** A fake plugin manifest contributing a flight.skill and a no-op overlay. */
const FIXTURE_MANIFEST = `id: com.example.follow
name: Example Follow Plugin
version: 1.0.0
risk: medium
gcs:
  permissions:
    - ui.slot.flight-skill
    - ui.slot.video-overlay
  contributes:
    skills:
      - id: follow-me
        label: Follow Me
        icon: Crosshair
        category: behavior
        toggle: true
        confirm: true
        arm_requirement: armed
        default_binding:
          key: shift+f
          gamepad_button: 5
        activation:
          via: config
          config_key: follow_me_active
        state:
          via: event
          topic: follow_me.state
      - id: bad-skill
        label: Dropped
        activation:
          via: rpc
        state:
          via: event
          topic: x
`;

function clearRegistry(): void {
  useSkillRegistry.setState({
    skills: new Map(),
    states: new Map(),
    _order: new Map(),
    _seq: 0,
  });
}

function contribution(
  over: Partial<DroneSkillContribution> = {},
): DroneSkillContribution {
  return {
    installId: "install-1",
    pluginId: "com.example.follow",
    localId: "follow-me",
    label: "Follow Me",
    icon: "Crosshair",
    category: "behavior",
    toggle: true,
    confirm: false,
    armRequirement: "any",
    configKey: "follow_me_active",
    stateTopic: "follow_me.state",
    ...over,
  };
}

describe("manifest flight.skill parsing", () => {
  it("parses a valid contribution and drops an unsupported transport", () => {
    const parsed = parseManifestYaml(FIXTURE_MANIFEST);
    const skills = parsed.contributesSkills ?? [];
    // bad-skill (activation.via=rpc) is dropped; follow-me survives.
    expect(skills).toHaveLength(1);
    const s = skills[0];
    expect(s.id).toBe("follow-me");
    expect(s.label).toBe("Follow Me");
    expect(s.icon).toBe("Crosshair");
    expect(s.category).toBe("behavior");
    expect(s.toggle).toBe(true);
    expect(s.confirm).toBe(true);
    expect(s.armRequirement).toBe("armed");
    expect(s.activation).toEqual({ via: "config", configKey: "follow_me_active" });
    expect(s.state).toEqual({ via: "event", topic: "follow_me.state" });
    expect(s.defaultBinding).toEqual({ key: "shift+f", gamepadButton: 5 });
  });
});

describe("category mapping", () => {
  it("maps navigation/utility to behavior and camera to camera", () => {
    expect(mapSkillCategory("behavior")).toBe("behavior");
    expect(mapSkillCategory("navigation")).toBe("behavior");
    expect(mapSkillCategory("utility")).toBe("behavior");
    expect(mapSkillCategory("camera")).toBe("camera");
  });
});

describe("buildPluginSkill", () => {
  beforeEach(() => {
    clearRegistry();
    usePluginSkillHostStore.setState({ writer: null, states: new Map() });
    useDroneManager.setState({ selectedDroneId: null });
  });

  it("registers and resolves for the drone it was built for", () => {
    const skill = buildPluginSkill(contribution());
    expect(skill.id).toBe(pluginSkillId("com.example.follow", "follow-me"));
    expect(skill.source).toBe("plugin");
    expect(skill.pluginId).toBe("com.example.follow");
    expect(skill.category).toBe("behavior");

    useSkillRegistry.getState().register(skill);
    const ids = useSkillRegistry
      .getState()
      .resolveForDrone("drone-1")
      .map((s) => s.id);
    expect(ids).toContain(skill.id);
  });

  it("activate flips the plugin config to true via the wired writer", async () => {
    const writes: Array<{ configKey: string; value: boolean }> = [];
    const writer: PluginConfigWriter = (input) => {
      writes.push({ configKey: input.configKey, value: input.value });
    };
    usePluginSkillHostStore.getState().setPluginConfigWriter(writer);

    const skill = buildPluginSkill(contribution({ confirm: false }));
    const ctx: SkillContext = {
      ...buildSkillContext("drone-1"),
      armState: "armed",
    };
    await skill.activate(ctx);
    expect(writes).toEqual([{ configKey: "follow_me_active", value: true }]);
  });

  it("notifies the operator when no config writer is wired", async () => {
    const notify = vi.fn();
    const skill = buildPluginSkill(contribution());
    const ctx: SkillContext = {
      ...buildSkillContext("drone-1"),
      armState: "armed",
      notify,
    };
    await skill.activate(ctx);
    expect(notify).toHaveBeenCalledWith(
      "skills.plugin.reason.noConfigSeam",
      "warning",
    );
  });

  it("getState reads the cached plugin event for the topic", () => {
    const skill = buildPluginSkill(contribution());
    const ctx = buildSkillContext("drone-1");

    // No event yet -> idle.
    expect(skill.getState(ctx).kind).toBe("idle");

    usePluginSkillHostStore
      .getState()
      .pushPluginSkillState("drone-1", "follow_me.state", {
        state: "active",
        badge: "T7",
      });
    const st = skill.getState(ctx);
    expect(st.kind).toBe("active");
    expect(st.badge).toBe("T7");

    // A different drone's state is isolated.
    expect(skill.getState({ ...ctx, droneId: "drone-2" }).kind).toBe("idle");
  });

  it("the dispatch pipeline flips config through activate for a plugin skill", async () => {
    const writes: boolean[] = [];
    usePluginSkillHostStore.getState().setPluginConfigWriter((input) => {
      writes.push(input.value);
    });
    const skill = buildPluginSkill(contribution({ confirm: false }));
    useSkillRegistry.getState().register(skill);
    useDroneManager.setState({ selectedDroneId: "drone-1" });

    const ctx: SkillContext = {
      ...buildSkillContext("drone-1"),
      armState: "armed",
    };
    await activate(skill.id, ctx);
    expect(writes).toContain(true);
  });
});
