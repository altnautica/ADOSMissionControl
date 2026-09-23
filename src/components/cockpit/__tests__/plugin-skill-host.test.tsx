import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DroneSkillContribution } from "@/lib/skills/plugin-skills";
import type * as HostStore from "@/lib/skills/plugin-skill-host-store";

const writer = vi.fn();
let resolved: Record<string, DroneSkillContribution[] | null> = {};

vi.mock("@/hooks/use-drone-skill-contributions", () => ({
  useDroneSkillContributions: (agentId: string | undefined) =>
    agentId ? (resolved[agentId] ?? null) : [],
}));
vi.mock("@/hooks/use-plugin-skill-egress", () => ({
  usePluginSkillEgress: () => {},
}));
vi.mock("@/lib/skills/plugin-config-writer", async () => {
  const store = await vi.importActual<typeof HostStore>(
    "@/lib/skills/plugin-skill-host-store",
  );
  // The writer stays wired through unmount so a teardown stop would reach it
  // whatever order the host's effect cleanups run in.
  return {
    installPluginConfigWriter: () =>
      store.usePluginSkillHostStore.getState().setPluginConfigWriter(writer),
    uninstallPluginConfigWriter: () => {},
  };
});

import { PluginSkillHost } from "@/components/cockpit/PluginSkillHost";
import { useSkillRegistry } from "@/lib/skills";
import { usePluginSkillHostStore } from "@/lib/skills/plugin-skill-host-store";
import { useDroneManager } from "@/stores/drone-manager";

const SKILL_ID = "com.example.follow:follow";

function followContribution(): DroneSkillContribution {
  return {
    installId: "install-1",
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
  };
}

/** Drone A has the follow skill running (plugin-reported active state). */
function followActiveOnA(): void {
  usePluginSkillHostStore
    .getState()
    .pushPluginSkillState("drone-a", "follow.state", { state: "active" });
  resolved = { "drone-a": [followContribution()], "drone-b": [] };
  useDroneManager.setState({ selectedDroneId: "drone-a" });
}

describe("PluginSkillHost", () => {
  beforeEach(() => {
    writer.mockClear();
    usePluginSkillHostStore.getState().clear();
    followActiveOnA();
  });
  afterEach(() => {
    cleanup();
    useDroneManager.setState({ selectedDroneId: null });
    useSkillRegistry.getState().unregister(SKILL_ID);
  });

  it("registers the drone's plugin skill with its live state", () => {
    render(<PluginSkillHost />);
    expect(useSkillRegistry.getState().skills.has(SKILL_ID)).toBe(true);
    expect(useSkillRegistry.getState().getState("drone-a", SKILL_ID).kind).toBe("active");
  });

  it("never stops the running skill when the operator selects another drone", () => {
    render(<PluginSkillHost />);
    act(() => useDroneManager.setState({ selectedDroneId: "drone-b" }));
    expect(useSkillRegistry.getState().skills.has(SKILL_ID)).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it("re-registers in place when the contribution list changes identity", () => {
    const { rerender } = render(<PluginSkillHost />);
    resolved = { ...resolved, "drone-a": [followContribution()] };
    rerender(<PluginSkillHost />);
    expect(useSkillRegistry.getState().skills.has(SKILL_ID)).toBe(true);
    expect(writer).not.toHaveBeenCalled();
  });

  it("keeps the registration while the same drone's source is resolving", () => {
    const { rerender } = render(<PluginSkillHost />);
    resolved = { ...resolved, "drone-a": null };
    rerender(<PluginSkillHost />);
    expect(useSkillRegistry.getState().skills.has(SKILL_ID)).toBe(true);
    expect(writer).not.toHaveBeenCalled();
  });

  it("never stops the running skill on host unmount", () => {
    const { unmount } = render(<PluginSkillHost />);
    unmount();
    expect(useSkillRegistry.getState().skills.has(SKILL_ID)).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it("stops the skill on its drone when it is uninstalled from that drone", () => {
    const { rerender } = render(<PluginSkillHost />);
    resolved = { ...resolved, "drone-a": [] };
    rerender(<PluginSkillHost />);
    expect(useSkillRegistry.getState().skills.has(SKILL_ID)).toBe(false);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith({
      droneId: "drone-a",
      pluginId: "com.example.follow",
      configKey: "active",
      value: false,
    });
  });
});
