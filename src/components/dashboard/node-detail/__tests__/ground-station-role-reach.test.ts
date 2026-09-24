/**
 * @module node-detail/ground-station-role-reach.test
 * @description The only role picker in node detail used to live inside two
 * tabs that were BOTH gated on the node already being a relay or receiver, so
 * a `direct` node (a solo ground station) and an `unset` node (freshly imaged,
 * never configured) could never reach it — the two empty-state branches
 * written for exactly those roles were unreachable code. An operator who
 * installed a second ground node had no way to make it one.
 *
 * `unset` had a second failure: `deriveRole` dropped the agent's own honest
 * answer, so the store kept `undefined` ("keep prior") forever and the node
 * resolved to role `null`, indistinguishable from "the field is missing".
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { resolveSurfaces } from "@/components/dashboard/node-detail/surfaces";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";
import { deriveRole } from "@/stores/agent-capabilities/derivers";
import type { AgentRole } from "@/stores/agent-capabilities/types";

function gs(role: AgentRole): SurfaceContext {
  return {
    droneId: "node:gs1",
    drone: { profile: "ground-station" } as SurfaceContext["drone"],
    displayName: "gs1",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: "dev-1",
    agentIdentityKnown: true,
    relayReach: null,
    fcLinking: false,
    radioPresent: "absent",
    visionPresent: "absent",
    crsfPresent: "absent",
    role,
    capabilitiesKnown: true,
    showLockedTabs: false,
    pluginAgentPages: [],
  };
}

describe("a ground station can always reach its role picker", () => {
  it("offers the Mesh & RX surface at every role, including direct and unset", () => {
    for (const role of ["direct", "unset", "relay", "receiver", null] as const) {
      expect(resolveSurfaces(gs(role), []).map((s) => s.id)).toContain("mesh");
    }
  });

  it("has exactly one mesh surface — Distributed RX is folded into it", () => {
    const ids = resolveSurfaces(gs("relay"), []).map((s) => s.id);
    expect(ids.filter((id) => id === "mesh")).toHaveLength(1);
    expect(ids).not.toContain("distributedRx");
  });
});

describe("deriveRole", () => {
  it("keeps the agent's `unset` answer instead of collapsing it to undefined", () => {
    // undefined means "the heartbeat omitted the field, keep the prior value",
    // which is what silently pinned a fresh ground station at role null.
    expect(deriveRole({ role: "unset" })).toBe("unset");
  });

  it("still distinguishes an explicit null from a missing field", () => {
    expect(deriveRole({ role: null })).toBeNull();
    expect(deriveRole({})).toBeUndefined();
    expect(deriveRole({ role: "nonsense" })).toBeUndefined();
  });

  it("passes the three operator-selectable roles through", () => {
    for (const role of ["direct", "relay", "receiver"] as const) {
      expect(deriveRole({ role })).toBe(role);
    }
  });
});
