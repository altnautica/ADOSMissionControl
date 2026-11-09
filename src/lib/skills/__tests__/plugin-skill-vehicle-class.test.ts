/**
 * @license GPL-3.0-only
 *
 * A plugin skill's manifest `vehicle_classes` holds on every path: on an
 * excluded class the skill reads disabled, so a key or pad binding that goes
 * through `activate()` is refused with the reason, not only hidden in the
 * picker.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Utils from "@/lib/utils";

vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof Utils>()),
  isDemoMode: () => true,
}));

import { activate, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import {
  PLUGIN_VEHICLE_CLASS_REASON,
  buildPluginSkill,
  type DroneSkillContribution,
} from "@/lib/skills/plugin-skills";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { PilotState } from "@/lib/cockpit/layers/cockpit-frames";

const DRONE = "drone-vc";

function contribution(): DroneSkillContribution {
  return {
    installId: "i-1",
    pluginId: "com.example.follow",
    localId: "follow",
    label: "Follow",
    icon: "Sparkles",
    category: "behavior",
    toggle: true,
    confirm: false,
    armRequirement: null,
    configKey: "active",
    stateTopic: "follow.state",
    vehicleClasses: ["multirotor"],
  };
}

function pilotClass(vehicleClass: PilotState["vehicleClass"]): void {
  useNavStreamStore.setState({
    byDrone: {
      [DRONE]: {
        pilot: { data: { vehicleClass } as PilotState, receivedAt: Date.now() },
      } as never,
    },
  });
}

afterEach(() => {
  useNavStreamStore.setState({ byDrone: {} });
  useSkillRegistry.getState().unregister("com.example.follow:follow");
});

describe("plugin skill vehicle classes", () => {
  it("reads disabled on an excluded vehicle class", () => {
    const skill = buildPluginSkill(contribution());
    pilotClass("fixedwing");
    expect(skill.getState(buildSkillContext(DRONE))).toEqual({
      kind: "disabled",
      reason: PLUGIN_VEHICLE_CLASS_REASON,
    });
  });

  it("stays available on an included class", () => {
    const skill = buildPluginSkill(contribution());
    pilotClass("multirotor");
    expect(skill.getState(buildSkillContext(DRONE)).kind).not.toBe("disabled");
  });

  it("refuses a key or pad activation on an excluded class with the reason", async () => {
    const skill = buildPluginSkill(contribution());
    const run = vi.fn();
    skill.activate = run;
    useSkillRegistry.getState().register(skill);
    pilotClass("fixedwing");
    const notify = vi.fn();
    await activate(skill.id, { ...buildSkillContext(DRONE), notify });
    expect(run).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(PLUGIN_VEHICLE_CLASS_REASON, "warning");
  });
});
