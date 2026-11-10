/**
 * @license GPL-3.0-only
 *
 * Starting Follow-Me from the skill bar in the demo hands the armed pilot to
 * the skill (owner `skill`, the Follow-Me plugin's skill), so the follow strip
 * and the follow feed are reachable without a pin; stopping it hands the pilot
 * back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import { mockEngine } from "@/mock/engine";
import { mockPilot } from "@/mock/mock-pilot";
import { MockProtocol } from "@/mock/mock-protocol";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { resolveNodeId } from "@/stores/node-registry";
import { useSettingsStore } from "@/stores/settings-store";

const ID = resolveNodeId("alpha-1");
const DEVICE = deviceIdFromNodeId(ID) ?? ID;

const pilot = () => useNavStreamStore.getState().byDrone[ID]?.pilot?.data;

beforeEach(() => {
  vi.useFakeTimers();
  void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  mockEngine.start(50);
  const protocol = useDroneManager.getState().drones.get(ID)?.protocol as MockProtocol;
  protocol.flight.init({ armed: true, airborne: true, mode: "GUIDED" });
  mockPilot.start(ID);
  vi.advanceTimersByTime(200);
});

afterEach(() => {
  mockPilot.stop();
  mockEngine.stop();
  useNavStreamStore.getState().clear(ID);
  void useSettingsStore.setState({ demoMode: false });
  vi.useRealTimers();
});

describe("demo Follow-Me start from the skill bar", () => {
  it("sets the demo owner to the skill, and back to the pilot on stop", async () => {
    expect(mockPilot.followSkillActive()).toBe(false);
    await expect(
      writePluginConfigValue({ droneId: DEVICE, pluginId: FOLLOW_ME_PLUGIN_ID, key: "active", value: true }),
    ).resolves.toBe(true);
    vi.advanceTimersByTime(200);
    expect(mockPilot.followSkillActive()).toBe(true);
    expect(pilot()?.owner).toBe("skill");

    await writePluginConfigValue({ droneId: DEVICE, pluginId: FOLLOW_ME_PLUGIN_ID, key: "active", value: false });
    vi.advanceTimersByTime(200);
    expect(mockPilot.followSkillActive()).toBe(false);
    expect(pilot()?.owner).toBe("pilot");
  });
});
