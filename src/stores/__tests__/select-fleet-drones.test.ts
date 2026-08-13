/**
 * @license GPL-3.0-only
 *
 * Tests for the pure node-registry → FleetDrone projection. Covers the four
 * behaviors the cutover depends on: one physical node yields one row (dedupe),
 * an FC-less node hides arm/mode/battery (no fabricated telemetry), liveness is
 * the freshest of presence / FC / cloud-status, and a cloud presence tick never
 * overwrites live FC flight state.
 */

import { describe, it, expect } from "vitest";

import {
  selectFleetDrones,
  nodeEntryToFleetDrone,
} from "../node-registry/select-fleet-drones";
import type { NodeEntry } from "../node-registry/types";
import type { CommandCloudStatus } from "../command-fleet-store";
import { STALE_THRESHOLD_MS, OFFLINE_THRESHOLD_MS } from "@/lib/agent/freshness";

const NOW = 1_000_000_000_000;

function entry(over: Partial<NodeEntry> = {}): NodeEntry {
  return {
    nodeId: "node:dev",
    presence: {
      deviceId: "dev",
      name: "Skynode",
      profile: "drone",
      sources: ["local"],
      lastHeartbeat: NOW,
      ...over.presence,
    },
    connection: { fcConnected: false, ...over.connection },
    fc: { managedId: null, ...over.fc },
    ...over,
  };
}

describe("nodeEntryToFleetDrone — FC gating (no fabricated telemetry)", () => {
  it("hides arm/mode/battery/gps/position when no FC is attached", () => {
    const row = nodeEntryToFleetDrone(entry(), undefined, NOW);
    expect(row.fcAttached).toBe(false);
    expect(row.battery).toBeUndefined();
    expect(row.gps).toBeUndefined();
    expect(row.position).toBeUndefined();
    // armState defaults to disarmed but the card hides it via fcAttached.
    expect(row.armState).toBe("disarmed");
    expect(row.status).toBe("online");
  });

  it("surfaces real FC telemetry when an FC is attached", () => {
    const row = nodeEntryToFleetDrone(
      entry({
        fc: {
          managedId: "node:dev",
          armState: "armed",
          flightMode: "LOITER",
          status: "in_mission",
          lastHeartbeat: NOW,
          battery: {
            timestamp: NOW,
            voltage: 16,
            current: 12,
            remaining: 73,
            consumed: 100,
          },
        },
      }),
      undefined,
      NOW,
    );
    expect(row.fcAttached).toBe(true);
    expect(row.armState).toBe("armed");
    expect(row.flightMode).toBe("LOITER");
    expect(row.status).toBe("in_mission");
    expect(row.battery?.remaining).toBe(73);
  });
});

describe("nodeEntryToFleetDrone — liveness", () => {
  it("is online when the freshest of presence / fc / cloud is within stale window", () => {
    // Stale presence, but a fresh cloud status keeps it online.
    const row = nodeEntryToFleetDrone(
      entry({ presence: { ...entry().presence, lastHeartbeat: NOW - OFFLINE_THRESHOLD_MS } }),
      { deviceId: "dev", updatedAt: NOW } as CommandCloudStatus,
      NOW,
    );
    expect(row.status).toBe("online");
  });

  it("is offline only when every source is past the offline threshold", () => {
    const old = NOW - OFFLINE_THRESHOLD_MS - 1;
    const row = nodeEntryToFleetDrone(
      entry({ presence: { ...entry().presence, lastHeartbeat: old } }),
      undefined,
      NOW,
    );
    expect(row.status).toBe("offline");
  });

  it("a fresh FC heartbeat keeps an otherwise-stale presence online", () => {
    const row = nodeEntryToFleetDrone(
      entry({
        presence: { ...entry().presence, lastHeartbeat: NOW - STALE_THRESHOLD_MS - 5000 },
        fc: { managedId: "node:dev", lastHeartbeat: NOW },
      }),
      undefined,
      NOW,
    );
    expect(row.status).not.toBe("offline");
  });
});

describe("selectFleetDrones — dedupe + cloud merge", () => {
  it("projects one row per node (both transports already collapsed)", () => {
    const nodes: Record<string, NodeEntry> = {
      "node:a": entry({
        nodeId: "node:a",
        presence: {
          deviceId: "a",
          name: "A",
          profile: "drone",
          sources: ["local", "cloud"],
          lastHeartbeat: NOW,
        },
      }),
    };
    const rows = selectFleetDrones({ nodes, cloudStatuses: {}, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("node:a");
    // Seen on cloud → source reads "cloud".
    expect(rows[0].source).toBe("cloud");
  });

  it("merges cloud-only display pills by deviceId without touching FC state", () => {
    const nodes: Record<string, NodeEntry> = {
      "node:b": entry({
        nodeId: "node:b",
        presence: { deviceId: "b", name: "B", profile: "drone", sources: ["local"], lastHeartbeat: NOW },
        fc: {
          managedId: "node:b",
          armState: "armed",
          flightMode: "AUTO",
          lastHeartbeat: NOW,
        },
      }),
    };
    const cloudStatuses: Record<string, CommandCloudStatus> = {
      b: {
        deviceId: "b",
        navigationMode: "vio",
        attachedDisplayType: "hdmi",
        updatedAt: NOW,
      },
    };
    const rows = selectFleetDrones({ nodes, cloudStatuses, now: NOW });
    // Pills merged in...
    expect(rows[0].navigationMode).toBe("vio");
    expect(rows[0].attachedDisplayType).toBe("hdmi");
    // ...while the live FC flight state is untouched (the cloud row carried no
    // arm/mode, so a cloud tick can never overwrite it).
    expect(rows[0].armState).toBe("armed");
    expect(rows[0].flightMode).toBe("AUTO");
  });
});

describe("nodeEntryToFleetDrone — transitive-reach provenance", () => {
  it("projects the relay hop onto a relayed-only node", () => {
    const row = nodeEntryToFleetDrone(
      entry({
        nodeId: "node:drone-x",
        presence: {
          deviceId: "drone-x",
          name: "Drone X",
          profile: "drone",
          sources: ["relayed"],
          reachedVia: "node:gs-1",
          lastHeartbeat: NOW,
        },
      }),
      undefined,
      NOW,
    );
    expect(row.reachedVia).toBe("node:gs-1");
    expect(row.status).toBe("online");
  });

  it("leaves reachedVia undefined on a directly-reached node", () => {
    const row = nodeEntryToFleetDrone(entry(), undefined, NOW);
    expect(row.reachedVia).toBeUndefined();
  });

  it("a node seen relayed-then-direct is ONE row carrying both sources plus the hop", () => {
    // deviceId collapse: the relayed presence and the later direct pair merged
    // onto the same node:<deviceId> in the registry (mergePresence), so the
    // projection yields exactly ONE FleetDrone. The direct (local) source takes
    // reach precedence; the relay hop rides along as secondary provenance.
    const nodes: Record<string, NodeEntry> = {
      "node:drone-x": entry({
        nodeId: "node:drone-x",
        presence: {
          deviceId: "drone-x",
          name: "Drone X",
          profile: "drone",
          sources: ["relayed", "local"],
          reachedVia: "node:gs-1",
          lastHeartbeat: NOW,
        },
      }),
    };
    const rows = selectFleetDrones({ nodes, cloudStatuses: {}, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("node:drone-x");
    expect(rows[0].reachedVia).toBe("node:gs-1");
    // Direct reach wins the primary source label; the hop is the provenance.
    expect(rows[0].source).toBe("local");
  });
});

describe("nodeEntryToFleetDrone — agent identity is never synthesized", () => {
  it("carries the agent device id a paired source supplied", () => {
    const row = nodeEntryToFleetDrone(
      entry({
        presence: { ...entry().presence, cloudDeviceId: "dev" },
      }),
      undefined,
      NOW,
    );
    expect(row.cloudDeviceId).toBe("dev");
  });

  it("leaves the agent device id undefined on a relayed-only node", () => {
    // The relayed source publishes no cloudDeviceId: the GCS never paired with
    // this drone, its only path is another node's radio. Falling back to the
    // bare deviceId would advertise a direct reach that does not exist, and the
    // detail panel would dial an agent nothing can answer for.
    const row = nodeEntryToFleetDrone(
      entry({
        nodeId: "node:drone-x",
        presence: {
          deviceId: "drone-x",
          name: "Drone X",
          profile: "drone",
          sources: ["relayed"],
          reachedVia: "node:gs-1",
          lastHeartbeat: NOW,
        },
      }),
      undefined,
      NOW,
    );
    expect(row.cloudDeviceId).toBeUndefined();
    // The hop is still named — the node is reachable, just not directly.
    expect(row.reachedVia).toBe("node:gs-1");
  });

  it("carries the agent device id once a relayed node is also paired directly", () => {
    const row = nodeEntryToFleetDrone(
      entry({
        nodeId: "node:drone-x",
        presence: {
          deviceId: "drone-x",
          name: "Drone X",
          profile: "drone",
          sources: ["relayed", "local"],
          cloudDeviceId: "drone-x",
          reachedVia: "node:gs-1",
          lastHeartbeat: NOW,
        },
      }),
      undefined,
      NOW,
    );
    expect(row.cloudDeviceId).toBe("drone-x");
  });
});

describe("nodeEntryToFleetDrone — health is measured, never inferred", () => {
  it("leaves healthScore undefined when no FC reported one", () => {
    const online = nodeEntryToFleetDrone(entry(), undefined, NOW);
    expect(online.status).toBe("online");
    expect(online.healthScore).toBeUndefined();
  });

  it("leaves healthScore undefined on an offline node too", () => {
    const row = nodeEntryToFleetDrone(
      entry({
        presence: {
          ...entry().presence,
          lastHeartbeat: NOW - OFFLINE_THRESHOLD_MS - 1,
        },
      }),
      undefined,
      NOW,
    );
    expect(row.status).toBe("offline");
    expect(row.healthScore).toBeUndefined();
  });

  it("passes through a health score the FC actually reported", () => {
    const row = nodeEntryToFleetDrone(
      entry({ fc: { managedId: "node:dev", healthScore: 42 } }),
      undefined,
      NOW,
    );
    expect(row.healthScore).toBe(42);
  });
});

describe("nodeEntryToFleetDrone — FC-link hint projection", () => {
  it("projects the cloud-status fcLinkHint onto the fleet row", () => {
    const status = { deviceId: "dev", fcLinkHint: "msp_detected" } as CommandCloudStatus;
    const row = nodeEntryToFleetDrone(entry(), status, NOW);
    expect(row.fcLinkHint).toBe("msp_detected");
  });

  it("leaves fcLinkHint undefined when no cloud status is present", () => {
    const row = nodeEntryToFleetDrone(entry(), undefined, NOW);
    expect(row.fcLinkHint).toBeUndefined();
  });
});
