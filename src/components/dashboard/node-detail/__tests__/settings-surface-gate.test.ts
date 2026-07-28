import { describe, expect, it } from "vitest";

import { resolveSurfaces } from "@/components/dashboard/node-detail/surfaces";
import { AGENT_NAV_ITEMS } from "@/components/dashboard/node-detail/agent/agent-nav-items";
import { resolveAgentNav } from "@/components/dashboard/node-detail/agent/agent-nav-sections";
import type { SettingsPageContext } from "@/components/command/settings/settings-nav";
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
    agentIdentityKnown: false,
    relayReach: null,
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

describe("Configuration pages in the merged Agent sidebar", () => {
  /** The pages a node offers, with a loaded config advertising every optional
   *  feature block so profile fit is the only variable. */
  const configPageIds = (c: SurfaceContext) => {
    const settingsCtx: SettingsPageContext = {
      droneId: c.droneId,
      profile: c.drone.profile ?? "drone",
      config: { swarm: {}, atlas: {} },
      readOnly: false,
      setValue: async () => {},
    };
    return resolveAgentNav(c, settingsCtx)
      .entries.filter((e) => e.isConfigPage)
      .map((e) => e.id);
  };

  it("offers them to a companion-backed drone (paired agent)", () => {
    const ids = configPageIds(
      ctx({ agentDeviceId: "dev-1", showLockedTabs: false }),
    );
    expect(ids).toContain("profile");
    expect(ids).toContain("advanced");
  });

  it("offers them to a workstation node", () => {
    expect(
      configPageIds(
        ctx({
          drone: { profile: "workstation" } as SurfaceContext["drone"],
          agentDeviceId: "dev-1",
          showLockedTabs: false,
        }),
      ),
    ).toContain("profile");
  });

  it("offers them to a ground-station node", () => {
    expect(
      configPageIds(
        ctx({
          drone: { profile: "ground-station" } as SurfaceContext["drone"],
          agentDeviceId: "dev-1",
          showLockedTabs: false,
        }),
      ),
    ).toContain("profile");
  });

  it("offers none of them on an FC-only node (no companion agent)", () => {
    // The gate the retired `settings` sub-page carried, now inherited by the
    // whole configuration half of the sidebar.
    expect(
      configPageIds(ctx({ agentDeviceId: null, showLockedTabs: true })),
    ).toEqual([]);
  });

  it("Logs is always available (even on an FC-only drone)", () => {
    expect(shows("logs", ctx({ agentDeviceId: null, showLockedTabs: true }))).toBe(true);
  });
});
