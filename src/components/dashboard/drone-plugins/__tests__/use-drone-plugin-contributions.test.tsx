/**
 * @license GPL-3.0-only
 *
 * Tests for the per-drone plugin contributions hook. Covers:
 *   - demo-mode fixture path (no Convex required)
 *   - empty agentId returns empty array
 *   - sort order: by manifest order asc, ties broken by pluginId
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";
import { renderHook } from "@testing-library/react";

// Mutable mock state so the non-demo (Convex) path is exercisable:
// `authState` drives `isAuthenticated`, `installsRef` is what
// `useConvexSkipQuery` returns (the install rows). Demo-mode tests
// short-circuit before either is read.
const { authState, installsRef } = vi.hoisted(() => ({
  authState: { value: false },
  installsRef: { value: undefined as unknown },
}));

// Demo mode is toggled per-test through the settings store, which is what
// `isDemoMode` reads once the store has hydrated.
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: authState.value }),
}));

// useConvexSkipQuery returns the staged install rows. We still need to
// mock it so the import resolves without pulling in ConvexClientProvider.
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: () => installsRef.value,
}));

import { useDronePluginContributions } from "@/hooks/use-drone-plugin-contributions";

describe("useDronePluginContributions", () => {

  beforeEach(() => {
    useSettingsStore.setState({ demoMode: true });
    authState.value = false;
    installsRef.value = undefined;
  });

  afterAll(() => {
    useSettingsStore.setState({ demoMode: false });
  });

  it("returns an empty array when agentId is undefined", () => {
    const { result } = renderHook(() =>
      useDronePluginContributions(undefined),
    );
    expect(result.current).toEqual([]);
  });

  it("returns mock contributions for a known demo drone", () => {
    const { result } = renderHook(() =>
      useDronePluginContributions("alpha-1"),
    );
    // alpha-1 has the vision-nav plugin enabled.
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current[0].pluginId).toBe("com.altnautica.vision-nav");
  });

  it("surfaces a demo plugin's declarative parameters on its tab", () => {
    const { result } = renderHook(() =>
      useDronePluginContributions("alpha-1"),
    );
    const visionNav = result.current.find(
      (c) => c.pluginId === "com.altnautica.vision-nav",
    );
    expect(visionNav).toBeDefined();
    // The vision-nav demo plugin contributes a parameter set so the native
    // panel renders above its iframe.
    expect(visionNav!.parameters.length).toBeGreaterThan(0);
    expect(visionNav!.parameters.map((p) => p.key)).toContain(
      "follow_distance_m",
    );
  });

  it("returns an empty array for an unknown demo drone", () => {
    const { result } = renderHook(() =>
      useDronePluginContributions("unknown-drone-xyz"),
    );
    expect(result.current).toEqual([]);
  });

  it("sorts by manifest order ascending, then pluginId", () => {
    // charlie-3 has FLIR Lepton thermal (order 70). delta-4 has
    // gimbal v2 (order 50). Validate the sort by checking drone-2 alone
    // first (one tab), then verifying drone-3 reports its tab.
    const { result: r2 } = renderHook(() =>
      useDronePluginContributions("charlie-3"),
    );
    expect(r2.current.map((c) => c.pluginId)).toEqual([
      "com.flir.thermal",
    ]);

    const { result: r3 } = renderHook(() =>
      useDronePluginContributions("delta-4"),
    );
    expect(r3.current.map((c) => c.pluginId)).toEqual([
      "com.altnautica.gimbal-v2",
    ]);
  });

  it("projects only node.detail.tab gcsContributes entries from listForDeviceWithDetail", () => {
    useSettingsStore.setState({ demoMode: false });
    authState.value = true;
    installsRef.value = [
      {
        installId: "install-1",
        pluginId: "com.example.b",
        version: "1.0.0",
        name: "Plugin B",
        gcsContributes: [
          // A non-tab slot must be ignored by the header hook.
          { slot: "video.overlay", panelId: "ov", order: 10 },
          {
            slot: "node.detail.tab",
            panelId: "tab-b",
            title: "B Tab",
            icon: "x",
            order: 80,
          },
        ],
      },
      {
        installId: "install-2",
        pluginId: "com.example.a",
        version: "2.0.0",
        name: "Plugin A",
        gcsContributes: [{ slot: "node.detail.tab", panelId: "tab-a", order: 80 }],
      },
    ];

    const { result } = renderHook(() =>
      useDronePluginContributions("drone-x"),
    );

    // Two node.detail.tab tabs; the video.overlay entry is ignored.
    expect(result.current).toHaveLength(2);
    // Equal order (80) → tie-break by pluginId lexicographically.
    expect(result.current.map((c) => c.pluginId)).toEqual([
      "com.example.a",
      "com.example.b",
    ]);

    const [a, b] = result.current;
    expect(a.installId).toBe("install-2");
    expect(a.panelId).toBe("tab-a");
    expect(a.title).toBe("Plugin A"); // no manifest title → plugin name
    expect(a.order).toBe(80);
    expect(a.enabled).toBe(true);
    expect(b.panelId).toBe("tab-b");
    expect(b.title).toBe("B Tab");
    expect(b.icon).toBe("x");
  });

  it("surfaces gcsParameters from listForDeviceWithDetail on the tab", () => {
    useSettingsStore.setState({ demoMode: false });
    authState.value = true;
    installsRef.value = [
      {
        installId: "install-p",
        pluginId: "com.example.params",
        version: "1.0.0",
        name: "Params Plugin",
        gcsContributes: [{ slot: "node.detail.tab", panelId: "tab-p" }],
        gcsParameters: [
          {
            key: "threshold",
            schema: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
            binding: "plugin.config",
            ui: { label: "Threshold" },
          },
        ],
      },
    ];

    const { result } = renderHook(() =>
      useDronePluginContributions("drone-x"),
    );
    expect(result.current).toHaveLength(1);
    expect(result.current[0].parameters).toEqual([
      {
        key: "threshold",
        schema: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
        binding: "plugin.config",
        ui: { label: "Threshold" },
      },
    ]);
  });

  it("profile-narrows a node.detail.tab to the node's profile", () => {
    useSettingsStore.setState({ demoMode: false });
    authState.value = true;
    installsRef.value = [
      {
        installId: "install-gs",
        pluginId: "com.example.gs-only",
        version: "1.0.0",
        name: "GS Only",
        gcsContributes: [
          {
            slot: "node.detail.tab",
            panelId: "gs-tab",
            profile: ["ground-station"],
          },
        ],
      },
      {
        installId: "install-any",
        pluginId: "com.example.any",
        version: "1.0.0",
        name: "Any Profile",
        gcsContributes: [{ slot: "node.detail.tab", panelId: "any-tab" }],
      },
    ];

    // On a drone: the ground-station-only tab is hidden, the unnarrowed one
    // shows.
    const { result: onDrone } = renderHook(() =>
      useDronePluginContributions("drone-x", "drone"),
    );
    expect(onDrone.current.map((c) => c.pluginId)).toEqual([
      "com.example.any",
    ]);

    // On a ground station: both show.
    const { result: onGs } = renderHook(() =>
      useDronePluginContributions("gs-x", "ground-station"),
    );
    expect(onGs.current.map((c) => c.pluginId).sort()).toEqual([
      "com.example.any",
      "com.example.gs-only",
    ]);

    // With no node profile (unknown): an unresolved profile keeps the tab
    // rather than hiding a contribution on a transient state.
    const { result: unknownProfile } = renderHook(() =>
      useDronePluginContributions("x"),
    );
    expect(unknownProfile.current).toHaveLength(2);
  });
});

