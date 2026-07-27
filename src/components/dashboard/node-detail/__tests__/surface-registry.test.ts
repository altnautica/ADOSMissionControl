/**
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import {
  resolveSurfaces,
  useSurfaceRegistry,
  type SurfaceContribution,
} from "@/components/dashboard/node-detail/surfaces";
import type {
  NodeProfile,
  SurfaceContext,
} from "@/components/dashboard/node-detail/surface-types";

/** A minimal SurfaceContext; overrides tune the profile / gate inputs. */
function ctx(over: Partial<SurfaceContext>): SurfaceContext {
  return {
    droneId: "node:d1",
    drone: { profile: "drone" } as SurfaceContext["drone"],
    displayName: "d1",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: "dev-1",
    agentIdentityKnown: true,
    relayReach: null,
    fcLinking: false,
    radioPresent: false,
    visionPresent: false,
    crsfPresent: false,
    role: "drone" as SurfaceContext["role"],
    showLockedTabs: false,
    isFeatureEnabled: () => false,
    atlasCapturing: false,
    ...over,
  };
}

function forProfile(profile: NodeProfile): SurfaceContext {
  return ctx({ drone: { profile } as SurfaceContext["drone"], role: null });
}

describe("node-detail surface registry (createContributionRegistry instance)", () => {
  it("resolves the built-in drone surfaces in authored order", () => {
    const ids = resolveSurfaces(forProfile("drone")).map((s) => s.id);
    expect(ids).toEqual([
      "overview",
      "flight",
      "cockpit",
      "configure",
      "parameters",
      "agent",
    ]);
  });

  it("appends the Agent surface to every profile", () => {
    for (const profile of [
      "drone",
      "ground-station",
      "workstation",
    ] as const) {
      const ids = resolveSurfaces(forProfile(profile)).map((s) => s.id);
      expect(ids[ids.length - 1]).toBe("agent");
    }
  });

  it("an unknown / future profile falls back to just the Agent page", () => {
    // A profile outside the built-in set (a future wire-contract profile) has
    // nothing registered, so it resolves to just the Agent page.
    const ids = resolveSurfaces(
      ctx({ drone: { profile: "compute" } as unknown as SurfaceContext["drone"] }),
    ).map((s) => s.id);
    expect(ids).toEqual(["agent"]);
  });

  it("hides the RC / ELRS Link tab for a node with no crsf lane, shows it when advertised", () => {
    // A node with no CRSF lane never surfaces the tab, on either profile.
    for (const profile of ["drone", "ground-station"] as const) {
      const absent = resolveSurfaces(
        ctx({
          drone: { profile } as SurfaceContext["drone"],
          role: null,
          crsfPresent: false,
        }),
      ).map((s) => s.id);
      expect(absent).not.toContain("rcElrs");

      const present = resolveSurfaces(
        ctx({
          drone: { profile } as SurfaceContext["drone"],
          role: null,
          crsfPresent: true,
        }),
      ).map((s) => s.id);
      expect(present).toContain("rcElrs");
    }
  });

  it("applies a surface `when` gate (a receiver ground station hides Radio)", () => {
    const receiverIds = resolveSurfaces(
      ctx({
        drone: { profile: "ground-station" } as SurfaceContext["drone"],
        role: "receiver",
      }),
    ).map((s) => s.id);
    expect(receiverIds).not.toContain("radio");

    const directIds = resolveSurfaces(
      ctx({
        drone: { profile: "ground-station" } as SurfaceContext["drone"],
        role: "direct",
      }),
    ).map((s) => s.id);
    expect(directIds).toContain("radio");
  });

  it("a built-in surface and a plugin surface share one registry, one shape, one ordered resolve", () => {
    const pluginTab: SurfaceContribution = {
      id: "drone:plugin-example",
      source: "plugin",
      // An ordered contribution sorts ahead of the unordered built-ins, proving
      // the plugin tab resolves through the SAME ordered list as the built-ins.
      order: -1,
      profile: "drone",
      payload: {
        id: "plugin-example",
        labelKey: "plugins.example",
        render: () => null,
      },
    };
    const { register, unregister, items } = useSurfaceRegistry.getState();

    // The built-in surfaces and the plugin tab live in the one store.
    expect(items.get("drone:overview")?.source).toBe("builtin");
    register(pluginTab);
    expect(useSurfaceRegistry.getState().items.get("drone:plugin-example")?.source).toBe(
      "plugin",
    );

    try {
      const ids = resolveSurfaces(forProfile("drone")).map((s) => s.id);
      // The ordered plugin tab leads; the built-ins keep their authored order.
      expect(ids).toEqual([
        "plugin-example",
        "overview",
        "flight",
        "cockpit",
        "configure",
        "parameters",
        "agent",
      ]);
    } finally {
      // Keep the singleton clean for sibling tests in this file.
      unregister("drone:plugin-example");
    }
  });
});
