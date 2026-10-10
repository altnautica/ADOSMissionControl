/**
 * Tests for plugin-contributed target actions: `buildPluginTargetAction`
 * designates the target then writes the plugin's config, and
 * `PluginTargetActionHost` registers a drone's contributions into the shared
 * registry (class-predicate honored) and cleans up on unmount.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  isDemoMode: () => true,
}));

const MOCK_CONTRIBS = [
  {
    installId: "i1",
    pluginId: "com.altnautica.follow-me",
    localId: "follow",
    label: "Follow this target",
    order: 20,
    appliesToClass: "person",
    designate: true,
    configKey: "active",
    configValue: true,
    defaultKey: "f",
  },
];
vi.mock("@/hooks/use-drone-target-actions", () => ({
  useDroneTargetActions: () => MOCK_CONTRIBS,
}));

type Gate = {
  pluginId: string;
  configKey: string;
  confirm: boolean;
  armRequirement: "any" | "armed" | "disarmed" | null;
};
const gatesRef: { value: Gate[] | null } = { value: [] };
vi.mock("@/hooks/use-drone-skill-contributions", () => ({
  useDroneSkillGates: () => gatesRef.value,
}));

import { PluginTargetActionHost } from "@/components/vision/PluginTargetActionHost";
import {
  buildPluginTargetAction,
  inheritSkillGates,
  resolveTargetActions,
  useTargetActionRegistry,
} from "@/lib/skills/target-actions";
import type { SkillContext } from "@/lib/skills/types";
import type { SelectedTarget } from "@/stores/selected-target-store";

const FOLLOW_GATE: Gate = {
  pluginId: "com.altnautica.follow-me",
  configKey: "active",
  confirm: true,
  armRequirement: "armed",
};

const PERSON: SelectedTarget = {
  droneId: "node:drone-1",
  cameraId: "cam0",
  trackId: 3,
  bbox: { x: 1, y: 2, width: 3, height: 4 },
  classLabel: "person",
  confidence: 0.9,
};

describe("buildPluginTargetAction", () => {
  it("designates then writes the plugin config on activate", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    const action = buildPluginTargetAction(
      {
        installId: "i1",
        pluginId: "p",
        localId: "follow",
        label: "Follow",
        designate: true,
        configKey: "active",
        configValue: true,
      },
      "node:drone-1",
      writeConfig,
    );
    await action.activate({ target: PERSON, notify });
    // deviceId is resolved from the node id.
    expect(writeConfig).toHaveBeenCalledWith("p", "drone-1", "active", true);
    expect(notify).toHaveBeenCalledWith("Follow", "success");
  });
});

describe("PluginTargetActionHost", () => {
  beforeEach(() => useTargetActionRegistry.setState({ actions: [] }));
  afterEach(() => cleanup());

  it("registers a drone's plugin target actions and honors the class predicate", () => {
    const { unmount } = render(<PluginTargetActionHost droneId="node:drone-1" />);

    const id = "com.altnautica.follow-me:follow";
    expect(
      useTargetActionRegistry.getState().actions.some((a) => a.id === id),
    ).toBe(true);

    // Applies to a person, not a car.
    expect(
      resolveTargetActions(PERSON).some((a) => a.id === id),
    ).toBe(true);
    expect(
      resolveTargetActions({ ...PERSON, classLabel: "car" }).some(
        (a) => a.id === id,
      ),
    ).toBe(false);

    unmount();
    expect(
      useTargetActionRegistry.getState().actions.some((a) => a.id === id),
    ).toBe(false);
  });
});

describe("inheritSkillGates", () => {
  const follow = { ...MOCK_CONTRIBS[0] };
  const stop = { ...follow, localId: "stop-follow", configValue: false };

  it("gives an activating action its skill's confirm and arm gates", () => {
    const [out] = inheritSkillGates([follow], [FOLLOW_GATE]);
    expect(out.confirm).toBe(true);
    expect(out.armRequirement).toBe("armed");
  });

  it("leaves a stop action (writes false) ungated, like a toggle-off", () => {
    const [out] = inheritSkillGates([stop], [FOLLOW_GATE]);
    expect(out.confirm).toBeUndefined();
    expect(out.armRequirement).toBeUndefined();
  });

  it("takes the strictest gates when several skills write the key", () => {
    const [out] = inheritSkillGates(
      [follow],
      [
        { ...FOLLOW_GATE, confirm: false, armRequirement: "any" },
        FOLLOW_GATE,
      ],
    );
    expect(out.confirm).toBe(true);
    expect(out.armRequirement).toBe("armed");
  });
});

describe("gated plugin target action", () => {
  const gated = { ...MOCK_CONTRIBS[0], confirm: true, armRequirement: "armed" as const };

  function ctx(armState: string, confirmed: boolean) {
    return {
      armState,
      confirm: vi.fn().mockResolvedValue(confirmed),
      notify: vi.fn(),
    } as unknown as SkillContext;
  }

  it("refuses while disarmed, without designating or writing", async () => {
    const writeConfig = vi.fn();
    const c = ctx("disarmed", true);
    const action = buildPluginTargetAction(gated, "node:drone-1", writeConfig, () => c);
    await action.activate({ target: PERSON, notify: vi.fn() });
    expect(writeConfig).not.toHaveBeenCalled();
    expect(c.notify).toHaveBeenCalledWith("skills.reason.notArmed", "warning");
  });

  it("writes only after the operator confirms", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const declined = ctx("armed", false);
    await buildPluginTargetAction(gated, "node:drone-1", writeConfig, () => declined).activate({
      target: PERSON,
      notify: vi.fn(),
    });
    expect(writeConfig).not.toHaveBeenCalled();

    const accepted = ctx("armed", true);
    await buildPluginTargetAction(gated, "node:drone-1", writeConfig, () => accepted).activate({
      target: PERSON,
      notify: vi.fn(),
    });
    expect(accepted.confirm).toHaveBeenCalledTimes(1);
    expect(writeConfig).toHaveBeenCalledWith("com.altnautica.follow-me", "drone-1", "active", true);
  });
});

describe("PluginTargetActionHost while skill gates load", () => {
  beforeEach(() => useTargetActionRegistry.setState({ actions: [] }));
  afterEach(() => {
    cleanup();
    gatesRef.value = [];
  });

  it("registers nothing until the gates resolve", () => {
    gatesRef.value = null;
    const { rerender } = render(<PluginTargetActionHost droneId="node:drone-1" />);
    expect(useTargetActionRegistry.getState().actions).toEqual([]);
    gatesRef.value = [FOLLOW_GATE];
    rerender(<PluginTargetActionHost droneId="node:drone-1" />);
    expect(useTargetActionRegistry.getState().actions.map((a) => a.id)).toEqual([
      "com.altnautica.follow-me:follow",
    ]);
  });
});
