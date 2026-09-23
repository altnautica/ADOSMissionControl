/**
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import { resolveSurfaces } from "@/components/dashboard/node-detail/surfaces";
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
    radioPresent: "absent",
    visionPresent: "absent",
    crsfPresent: "absent",
    role: "drone" as SurfaceContext["role"],
    capabilitiesKnown: true,
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
      "logs",
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
          crsfPresent: "absent",
        }),
      ).map((s) => s.id);
      expect(absent).not.toContain("rcElrs");

      const present = resolveSurfaces(
        ctx({
          drone: { profile } as SurfaceContext["drone"],
          role: null,
          crsfPresent: "present",
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
});
