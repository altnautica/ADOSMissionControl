/**
 * In demo, the one mock agent serves only nodes the demo reaches directly
 * and recently; an offline or relay-only node gets none.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { demoNodeReachable } from "@/components/command/settings/use-node-direct-agent";

const NOW = 1_000_000;

describe("demoNodeReachable", () => {
  it("lends the agent to a fresh direct node", () => {
    expect(demoNodeReachable({ sources: ["local"] }, NOW - 1000, NOW)).toBe(true);
  });

  it("refuses an offline node", () => {
    expect(demoNodeReachable({ sources: ["local"] }, NOW - 120_000, NOW)).toBe(false);
  });

  it("refuses a relay-only node", () => {
    expect(demoNodeReachable({ sources: ["relayed"] }, NOW, NOW)).toBe(false);
  });

  it("refuses an unknown node", () => {
    expect(demoNodeReachable(undefined, NOW, NOW)).toBe(false);
  });
});

describe("demoNodeReachable against the demo seed", () => {
  it("lends the agent to every seeded drone after the engine heartbeat window", async () => {
    const { seedDemoNodes } = await import("@/mock/engine-seed");
    const { useNodeRegistryStore } = await import("@/stores/node-registry");
    const seededAt = Date.now();
    seedDemoNodes(seededAt);
    const nodes = Object.values(useNodeRegistryStore.getState().nodes);
    const drones = nodes.filter((n) => n.fc.managedId);
    expect(drones.length).toBeGreaterThan(0);
    for (const n of drones) {
      const lastSeen = Math.max(n.presence.lastHeartbeat, n.fc.lastHeartbeat ?? 0);
      expect(demoNodeReachable(n.presence, lastSeen, seededAt + 1000)).toBe(true);
    }
  });
});
