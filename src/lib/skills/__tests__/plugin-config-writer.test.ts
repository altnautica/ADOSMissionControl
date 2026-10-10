/**
 * Tests for the live plugin config-write seam (`plugin-config-writer`): the
 * LAN-agent resolution, the boolean skill-toggle writer wired into the host
 * store, and the numeric/string iframe-settings write path. The agent
 * `PluginAgentClient` and the `local-nodes-store` are mocked so the test is
 * pure of network + browser storage.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { setConfig } = vi.hoisted(() => ({ setConfig: vi.fn() }));
vi.mock("@/lib/agent/plugin-client", () => ({
  // A real class so `new PluginAgentClient(...)` works; the instance delegates
  // setConfig to the hoisted spy.
  PluginAgentClient: class {
    constructor(_baseUrl: string, _apiKey: string) {}
    setConfig = setConfig;
  },
}));

let nodes: Array<{ deviceId: string; hostname: string; apiKey: string }> = [];
vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: { getState: () => ({ nodes }) },
}));

import {
  writePluginConfigValue,
  installPluginConfigWriter,
  uninstallPluginConfigWriter,
} from "../plugin-config-writer";
import {
  writePluginConfig,
  usePluginSkillHostStore,
} from "../plugin-skill-host-store";

const NODE = {
  deviceId: "d1",
  hostname: "http://drone.local:8080",
  apiKey: "k",
};

describe("plugin-config-writer", () => {
  beforeEach(() => {
    setConfig.mockReset();
    setConfig.mockResolvedValue({ set: true, scope: "drone" });
    nodes = [];
    usePluginSkillHostStore.getState().setPluginConfigWriter(null);
  });

  it("writePluginConfigValue returns false when the drone has no LAN node", async () => {
    const ok = await writePluginConfigValue({
      droneId: "d1",
      pluginId: "p",
      key: "follow_distance_m",
      value: 8,
    });
    expect(ok).toBe(false);
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("writePluginConfigValue writes a numeric setting through the LAN agent", async () => {
    nodes = [NODE];
    const ok = await writePluginConfigValue({
      droneId: "d1",
      pluginId: "p",
      key: "follow_distance_m",
      value: 8,
    });
    expect(ok).toBe(true);
    expect(setConfig).toHaveBeenCalledWith("p", "follow_distance_m", 8, "drone");
  });

  it("install wires the boolean skill-toggle writer; uninstall clears it", async () => {
    nodes = [NODE];
    // No writer wired yet -> the store reports no live seam (false).
    expect(
      await writePluginConfig({
        droneId: "d1",
        pluginId: "p",
        configKey: "active",
        value: true,
      }),
    ).toBe(false);

    installPluginConfigWriter();
    expect(
      await writePluginConfig({
        droneId: "d1",
        pluginId: "p",
        configKey: "active",
        value: true,
      }),
    ).toBe(true);
    expect(setConfig).toHaveBeenCalledWith("p", "active", true, "drone");

    uninstallPluginConfigWriter();
    expect(
      await writePluginConfig({
        droneId: "d1",
        pluginId: "p",
        configKey: "active",
        value: false,
      }),
    ).toBe(false);
  });

  it("the installed writer rejects a drone with no LAN seam (no fake-active)", async () => {
    installPluginConfigWriter();
    // No node for d2 -> the writer throws; writePluginConfig propagates the
    // rejection so the dispatcher marks the activation failed (the skill stays
    // in its plugin-reported state rather than lying active).
    await expect(
      writePluginConfig({
        droneId: "d2",
        pluginId: "p",
        configKey: "active",
        value: true,
      }),
    ).rejects.toThrow(/no LAN or ground-station path/);
  });
});
