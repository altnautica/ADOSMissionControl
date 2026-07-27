import { describe, expect, it } from "vitest";

import { AGENT_NAV_ITEMS } from "@/components/dashboard/node-detail/agent/agent-nav-items";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";

/** A minimal drone SurfaceContext; overrides tune the gate inputs under test. */
function ctx(over: Partial<SurfaceContext>): SurfaceContext {
  return {
    droneId: "node:d1",
    drone: { profile: "drone" } as SurfaceContext["drone"],
    displayName: "d1",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: null,
    agentIdentityKnown: false,
    fcLinking: false,
    radioPresent: false,
    visionPresent: false,
    crsfPresent: false,
    role: "drone" as SurfaceContext["role"],
    showLockedTabs: true,
    isFeatureEnabled: () => false,
    atlasCapturing: false,
    ...over,
  };
}

const item = (id: string) => AGENT_NAV_ITEMS.find((i) => i.id === id)!;
const shows = (id: string, c: SurfaceContext) => {
  const i = item(id);
  return i.when ? i.when(c) : true;
};

describe("Perception (vision) sub-page gate", () => {
  it("shows for any SBC/companion-backed drone, even with no engine running", () => {
    expect(
      shows(
        "vision",
        ctx({ agentDeviceId: "dev-1", showLockedTabs: false, visionPresent: false }),
      ),
    ).toBe(true);
  });

  it("shows for a companion drone that is already running vision", () => {
    expect(
      shows(
        "vision",
        ctx({ agentDeviceId: "dev-1", showLockedTabs: false, visionPresent: true }),
      ),
    ).toBe(true);
  });

  it("hides for an FC-only drone (no companion agent)", () => {
    expect(
      shows(
        "vision",
        ctx({ agentDeviceId: null, showLockedTabs: true, visionPresent: true }),
      ),
    ).toBe(false);
  });

  it("hides on non-drone profiles (ground station / workstation)", () => {
    for (const profile of ["ground-station", "workstation"] as const) {
      expect(
        shows(
          "vision",
          ctx({
            drone: { profile } as SurfaceContext["drone"],
            agentDeviceId: "dev-1",
            showLockedTabs: false,
          }),
        ),
      ).toBe(false);
    }
  });
});

describe("Perception section extra gates", () => {
  it("Link (radio) shows only for a drone with a radio present", () => {
    expect(
      shows("radio", ctx({ agentDeviceId: "dev-1", showLockedTabs: false, radioPresent: true })),
    ).toBe(true);
    // no radio -> hidden
    expect(
      shows("radio", ctx({ agentDeviceId: "dev-1", showLockedTabs: false, radioPresent: false })),
    ).toBe(false);
    // ground station keeps its own top-level Radio tab, so it is not an Agent sub-page here
    expect(
      shows(
        "radio",
        ctx({
          drone: { profile: "ground-station" } as SurfaceContext["drone"],
          showLockedTabs: false,
          radioPresent: true,
        }),
      ),
    ).toBe(false);
  });

  it("World Model needs the feature enabled; Live World also needs capturing", () => {
    const base = { agentDeviceId: "dev-1", showLockedTabs: false } as const;
    expect(shows("world-model", ctx({ ...base, isFeatureEnabled: () => false }))).toBe(false);
    expect(shows("world-model", ctx({ ...base, isFeatureEnabled: () => true }))).toBe(true);
    expect(
      shows("live-world", ctx({ ...base, isFeatureEnabled: () => true, atlasCapturing: false })),
    ).toBe(false);
    expect(
      shows("live-world", ctx({ ...base, isFeatureEnabled: () => true, atlasCapturing: true })),
    ).toBe(true);
  });
});
