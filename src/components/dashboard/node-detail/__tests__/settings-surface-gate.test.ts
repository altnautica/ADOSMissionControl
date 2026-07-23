import { describe, expect, it } from "vitest";

import { resolveSurfaces } from "@/components/dashboard/node-detail/surfaces";
import { AGENT_NAV_ITEMS } from "@/components/dashboard/node-detail/agent/agent-nav-items";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";

/** A minimal SurfaceContext; overrides tune the gate inputs under test. */
function ctx(over: Partial<SurfaceContext>): SurfaceContext {
  return {
    droneId: "node:d1",
    drone: { profile: "drone" } as SurfaceContext["drone"],
    displayName: "d1",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: null,
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

describe("Agent page hosts the companion surfaces", () => {
  it("every profile exposes the Agent tab at top level", () => {
    for (const profile of [
      "drone",
      "ground-station",
      "workstation",
    ] as const) {
      const ids = resolveSurfaces(
        ctx({
          drone: { profile } as SurfaceContext["drone"],
          showLockedTabs: false,
          agentDeviceId: "dev-1",
        }),
      ).map((s) => s.id);
      expect(ids).toContain("agent");
    }
  });

  it("no longer surfaces the moved companion tabs at the top level", () => {
    const ids = resolveSurfaces(
      ctx({ agentDeviceId: "dev-1", showLockedTabs: false, radioPresent: true }),
    ).map((s) => s.id);
    for (const moved of [
      "system",
      "settings",
      "plugins",
      "logs",
      "radio",
      "vision",
    ]) {
      expect(ids).not.toContain(moved);
    }
  });
});

describe("Settings sub-page gate", () => {
  it("shows for a companion-backed drone (paired agent)", () => {
    expect(shows("settings", ctx({ agentDeviceId: "dev-1", showLockedTabs: false }))).toBe(
      true,
    );
  });

  it("shows for a workstation node", () => {
    expect(
      shows(
        "settings",
        ctx({
          drone: { profile: "workstation" } as SurfaceContext["drone"],
          showLockedTabs: false,
        }),
      ),
    ).toBe(true);
  });

  it("shows for a ground-station node", () => {
    expect(
      shows(
        "settings",
        ctx({
          drone: { profile: "ground-station" } as SurfaceContext["drone"],
          showLockedTabs: false,
        }),
      ),
    ).toBe(true);
  });

  it("hides for an FC-only drone (no companion agent)", () => {
    expect(shows("settings", ctx({ agentDeviceId: null, showLockedTabs: true }))).toBe(
      false,
    );
  });

  it("Logs is always available (even on an FC-only drone)", () => {
    expect(shows("logs", ctx({ agentDeviceId: null, showLockedTabs: true }))).toBe(true);
  });
});
