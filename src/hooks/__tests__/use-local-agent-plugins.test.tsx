/**
 * @license GPL-3.0-only
 *
 * Tests for the local-first plugin source hook. Covers:
 *   - cloud / demo mode → inert (returns null so the cloud path wins)
 *   - signed-out + LAN node + local install record → fetches the agent
 *     detail and normalizes the raw manifest dicts (panels → slot entries,
 *     skills → camelCase rows with arm_requirement / activation.config_key /
 *     state.topic flattened)
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";
import { renderHook, waitFor } from "@testing-library/react";

const { authState, nodesRef, installsRef, getImpl } = vi.hoisted(() => ({
  authState: { value: false },
  nodesRef: { value: [] as Array<Record<string, unknown>> },
  installsRef: { value: [] as Array<Record<string, unknown>> },
  getImpl: { value: (async () => ({})) as (id: string) => Promise<unknown> },
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: authState.value }),
}));
vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: (sel: (s: { nodes: unknown[] }) => unknown) =>
    sel({ nodes: nodesRef.value }),
}));
vi.mock("@/stores/local-plugin-installs-store", () => ({
  useLocalPluginInstallsStore: (sel: (s: { installs: unknown[] }) => unknown) =>
    sel({ installs: installsRef.value }),
}));
vi.mock("@/lib/agent/plugin-client", () => ({
  PluginAgentClient: class {
    constructor(
      public baseUrl: string,
      public apiKey: string,
    ) {}
    get(id: string) {
      return getImpl.value(id);
    }
  },
}));

import { useLocalAgentPlugins } from "@/hooks/use-local-agent-plugins";

const FOLLOW_ME_DETAIL = {
  install: { status: "enabled" },
  manifest: {
    version: "0.1.0",
    name: "Follow-Me",
    gcs: {
      entrypoint: "gcs/plugin.bundle.js",
      contributes: {
        panels: [
          { id: "follow-me-overlay", slot: "video.overlay" },
          {
            id: "follow-me-tab",
            slot: "node.detail.tab",
            title: "Follow-Me",
            icon: "crosshair",
            order: 70,
          },
        ],
        overlays: [],
        notifications: [],
        // The tab carries its profile narrowing; the node.detail.tab slot
        // itself comes through `panels`.
        tabs: [{ id: "follow-me-tab", profile: ["drone"] }],
        parameters: [
          {
            key: "follow_distance_m",
            schema: { type: "number", minimum: 2, maximum: 30, default: 8 },
            binding: "plugin.config",
            ui: { label: "Follow distance", widget: "range" },
          },
        ],
        skills: [
          {
            id: "follow-me",
            label: "Follow-Me",
            icon: "crosshair",
            category: "behavior",
            toggle: true,
            confirm: false,
            arm_requirement: "armed",
            default_binding: { key: "f" },
            activation: { via: "config", config_key: "active" },
            state: { via: "event", topic: "follow.state" },
          },
        ],
        target_actions: [
          {
            id: "follow",
            label: "Follow this target",
            icon: "crosshair",
            order: 20,
            applies_to_class: "person",
            designate: true,
            config_key: "active",
            config_value: true,
            default_key: "f",
          },
        ],
      },
      locales: [],
    },
  },
  granted_capabilities: ["ui.slot.flight-skill", "command.send"],
};

describe("useLocalAgentPlugins", () => {

  beforeEach(() => {
    useSettingsStore.setState({ demoMode: false });
    authState.value = false;
    nodesRef.value = [
      {
        deviceId: "drone-1",
        hostname: "http://drone-1.local:8080",
        apiKey: "key-abc",
      },
    ];
    installsRef.value = [
      { pluginId: "com.altnautica.follow-me", deviceId: "drone-1" },
    ];
    getImpl.value = async () => FOLLOW_ME_DETAIL;
  });

  afterAll(() => {
    useSettingsStore.setState({ demoMode: false });
  });

  it("is inert (null) when signed in — the cloud path owns the surface", () => {
    authState.value = true;
    const { result } = renderHook(() => useLocalAgentPlugins("drone-1"));
    expect(result.current).toBeNull();
  });

  it("is inert (null) in demo mode", () => {
    useSettingsStore.setState({ demoMode: true });
    const { result } = renderHook(() => useLocalAgentPlugins("drone-1"));
    expect(result.current).toBeNull();
  });

  it("returns [] when no LAN node is paired for the device", () => {
    nodesRef.value = [];
    const { result } = renderHook(() => useLocalAgentPlugins("drone-1"));
    // active is false (no node), so the hook stays inert.
    expect(result.current).toBeNull();
  });

  it("normalizes the agent detail into slot + skill rows", async () => {
    const { result } = renderHook(() => useLocalAgentPlugins("drone-1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    const rows = result.current!;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.pluginId).toBe("com.altnautica.follow-me");
    expect(row.installId).toBe("drone-1::com.altnautica.follow-me");
    expect(row.status).toBe("enabled");
    expect(row.entrypoint).toBe("gcs/plugin.bundle.js");
    expect(row.bundle).toEqual({
      kind: "agent",
      agentUrl: "http://drone-1.local:8080",
      apiKey: "key-abc",
      entrypoint: "gcs/plugin.bundle.js",
      // An agent that reports no `gcs.isolation` serves an iframe bundle.
      isolation: "iframe",
    });
    expect(row.grantedCaps).toContain("ui.slot.flight-skill");

    // panels → slot entries (manifest `id` → `panelId`); the node.detail.tab
    // picks up its `profile` from the matching `tabs[]` entry.
    expect(row.gcsContributes).toEqual([
      { slot: "video.overlay", panelId: "follow-me-overlay" },
      {
        slot: "node.detail.tab",
        panelId: "follow-me-tab",
        title: "Follow-Me",
        icon: "crosshair",
        order: 70,
        profile: ["drone"],
      },
    ]);

    // parameters → parsed PluginParameter rows
    expect(row.gcsParameters).toEqual([
      {
        key: "follow_distance_m",
        schema: { type: "number", minimum: 2, maximum: 30, default: 8 },
        binding: "plugin.config",
        ui: { label: "Follow distance", widget: "range" },
      },
    ]);

    // skills → camelCase, flattened activation/state
    expect(row.flightSkills).toHaveLength(1);
    const skill = row.flightSkills[0];
    expect(skill.id).toBe("follow-me");
    expect(skill.armRequirement).toBe("armed");
    expect(skill.configKey).toBe("active");
    expect(skill.stateTopic).toBe("follow.state");
    expect(skill.toggle).toBe(true);
    expect(skill.defaultBinding).toEqual({ key: "f", gamepadButton: null });

    // target_actions → camelCase row, snake manifest keys normalized
    expect(row.targetActions).toHaveLength(1);
    const action = row.targetActions[0];
    expect(action.id).toBe("follow");
    expect(action.label).toBe("Follow this target");
    expect(action.appliesToClass).toBe("person");
    expect(action.designate).toBe(true);
    expect(action.configKey).toBe("active");
    expect(action.configValue).toBe(true);
    expect(action.defaultKey).toBe("f");
  });

  it("skips a plugin the agent no longer knows (get throws)", async () => {
    getImpl.value = async () => {
      throw new Error("404");
    };
    const { result } = renderHook(() => useLocalAgentPlugins("drone-1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([]);
  });

  describe("fleet (null device) branch", () => {
    it("is inert (null) when signed in", () => {
      authState.value = true;
      const { result } = renderHook(() => useLocalAgentPlugins(null));
      expect(result.current).toBeNull();
    });

    it("is inert (null) in demo mode", () => {
      useSettingsStore.setState({ demoMode: true });
      const { result } = renderHook(() => useLocalAgentPlugins(null));
      expect(result.current).toBeNull();
    });

    it("returns [] local-first when there are no fleet installs", () => {
      installsRef.value = [
        { pluginId: "com.altnautica.follow-me", deviceId: "drone-1" },
      ];
      const { result } = renderHook(() => useLocalAgentPlugins(null));
      expect(result.current).toEqual([]);
    });

    it("surfaces a fleet archive install straight from the store", () => {
      installsRef.value = [
        // a drone-bound install must NOT leak into the fleet surface
        { pluginId: "com.altnautica.follow-me", deviceId: "drone-1" },
        {
          pluginId: "com.example.sample-panel",
          deviceId: null,
          version: "1.2.0",
          name: "Sample Panel",
          grantedCaps: ["ui.slot.settings-section", "telemetry.read"],
          gcsContributes: [
            { slot: "settings.section", panelId: "sample-panel" },
          ],
          gcsParameters: [{ key: "warn_v" }],
          bundle: {
            kind: "archive",
            archiveUrl: "https://github.com/x/y/releases/download/v1/p.adosplug",
            entrypoint: "gcs/plugin.bundle.js",
            pin: { sha256: "ab".repeat(32), signerId: "example-2026-A" },
          },
        },
      ];
      const { result } = renderHook(() => useLocalAgentPlugins(null));
      expect(result.current).toHaveLength(1);
      const row = result.current![0];
      expect(row.installId).toBe("fleet::com.example.sample-panel");
      expect(row.pluginId).toBe("com.example.sample-panel");
      expect(row.status).toBe("enabled");
      expect(row.entrypoint).toBe("gcs/plugin.bundle.js");
      expect(row.gcsContributes).toEqual([
        { slot: "settings.section", panelId: "sample-panel" },
      ]);
      expect(row.gcsParameters).toEqual([{ key: "warn_v" }]);
      expect(row.bundle).toEqual({
        kind: "archive",
        archiveUrl: "https://github.com/x/y/releases/download/v1/p.adosplug",
        entrypoint: "gcs/plugin.bundle.js",
        pin: { sha256: "ab".repeat(32), signerId: "example-2026-A" },
      });
    });

    it("drops a fleet record with no offline-loadable bundle", () => {
      installsRef.value = [
        {
          pluginId: "com.altnautica.agent-only",
          deviceId: null,
          version: "1.0.0",
          name: "Agent Only",
          grantedCaps: [],
          gcsContributes: [],
          // an `agent`-kind bundle cannot resolve without a deviceId
          bundle: {
            kind: "agent",
            deviceId: "drone-1",
            entrypoint: "gcs/plugin.bundle.js",
          },
        },
      ];
      const { result } = renderHook(() => useLocalAgentPlugins(null));
      expect(result.current).toEqual([]);
    });
  });
});
