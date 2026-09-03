/**
 * @license GPL-3.0-only
 *
 * Tests for the fleet-node merge + live-FC enrichment. Focus: the live
 * command-fleet status (which carries the MSP variant/transport that a
 * reachable Betaflight/iNav FC advertises) is folded onto the merged node so
 * the sidebar can badge it as connected, and a pair-time fcConnected is
 * preserved when no live status exists yet.
 */

import { describe, it, expect } from "vitest";

import {
  mergeFleetNodes,
  enrichNodeWithLiveFc,
  adaptDirectFc,
  mergeFleetWithDirectFcs,
  adaptRelayed,
  mergeRelayedNodes,
  type FleetNodeEntry,
} from "../use-fleet-nodes";
import type { PairedDrone } from "@/stores/pairing-store";
import type { LocalNode } from "@/stores/local-nodes-store";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";
import type { ManagedDrone } from "@/stores/drone-manager";
import type { NodeEntry } from "@/stores/node-registry";
import { droneLiveness } from "@/components/command/fleet/types";

function relayedEntry(over: {
  deviceId?: string;
  name?: string;
  reachedVia?: string;
  sources?: NodeEntry["presence"]["sources"];
  lastHeartbeat?: number;
} = {}): NodeEntry {
  const deviceId = over.deviceId ?? "drone-a";
  return {
    nodeId: `node:${deviceId}`,
    presence: {
      deviceId,
      name: over.name ?? "Drone A",
      profile: "drone",
      sources: over.sources ?? ["relayed"],
      reachedVia: over.reachedVia ?? "node:gs-1",
      lastHeartbeat: over.lastHeartbeat ?? 100,
    },
    connection: { fcConnected: false },
    fc: { managedId: null },
    rev: 0,
  };
}

function nodeEntry(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return {
    _id: "node:dev",
    userId: "local",
    deviceId: "dev",
    name: "Skynode",
    apiKey: "k",
    pairedAt: 1,
    profile: "drone",
    isLocal: true,
    ...over,
  };
}

function status(over: Partial<CommandCloudStatus> = {}): CommandCloudStatus {
  return { deviceId: "dev", updatedAt: 1, ...over };
}

describe("enrichNodeWithLiveFc", () => {
  it("returns the node unchanged when there is no live status", () => {
    const n = nodeEntry({ fcConnected: true });
    expect(enrichNodeWithLiveFc(n, undefined)).toBe(n);
  });

  it("folds a reachable MSP FC's variant/transport onto the node", () => {
    const enriched = enrichNodeWithLiveFc(
      nodeEntry(),
      status({ fcConnected: false, fcVariant: "betaflight", transportOpen: true }),
    );
    expect(enriched.fcVariant).toBe("betaflight");
    expect(enriched.transportOpen).toBe(true);
    // fcConnected stays false (MSP never sets it) — reachability is derived
    // from the variant + transport downstream.
    expect(enriched.fcConnected).toBe(false);
  });

  it("prefers the live fcConnected over the pair-time value", () => {
    const enriched = enrichNodeWithLiveFc(
      nodeEntry({ fcConnected: false }),
      status({ fcConnected: true, fcFirmware: "ardupilot" }),
    );
    expect(enriched.fcConnected).toBe(true);
    expect(enriched.fcFirmware).toBe("ardupilot");
  });

  it("keeps the pair-time fcConnected when the live status omits it", () => {
    const enriched = enrichNodeWithLiveFc(
      nodeEntry({ fcConnected: true }),
      status({}),
    );
    expect(enriched.fcConnected).toBe(true);
  });
});

describe("mergeFleetNodes", () => {
  it("collapses a node seen on both transports to one row", () => {
    const cloud: PairedDrone = {
      _id: "cloud-id",
      userId: "u",
      deviceId: "dev",
      name: "Cloud name",
      apiKey: "ck",
      pairedAt: 5,
      fcConnected: true,
    };
    const local: LocalNode = {
      deviceId: "dev",
      name: "Local name",
      hostname: "http://192.168.0.5:8080",
      apiKey: "lk",
      profile: "drone",
      pairedAt: 6,
    };
    const merged = mergeFleetNodes([cloud], [local]);
    expect(merged).toHaveLength(1);
    // Local identity wins (apiKey), but the cloud freshness field is preserved.
    expect(merged[0].apiKey).toBe("lk");
    expect(merged[0].fcConnected).toBe(true);
    expect(merged[0].isLocal).toBe(true);
  });
});

function managedFc(over: Partial<ManagedDrone> = {}): ManagedDrone {
  return {
    id: "fc:abc12345",
    name: "BTFL 25.12.5 (MSP API 1.47) (copter)",
    protocol: { isConnected: true } as ManagedDrone["protocol"],
    transport: {} as ManagedDrone["transport"],
    vehicleInfo: {
      firmwareType: "betaflight",
      vehicleClass: "copter",
      firmwareVersionString: "BTFL 25.12.5 (MSP API 1.47)",
      systemId: 1,
      componentId: 1,
      autopilotType: 0,
      vehicleType: 2,
    } as ManagedDrone["vehicleInfo"],
    unsubscribers: [],
    connectedAt: 42,
    ownsFleetRow: true,
    _disconnectReason: null,
    ...over,
  };
}

describe("adaptDirectFc", () => {
  it("keys the entry on the managed id (== the selection id) and carries the real name", () => {
    const e = adaptDirectFc(managedFc());
    expect(e._id).toBe("fc:abc12345");
    expect(e.deviceId).toBe("fc:abc12345");
    expect(e.name).toBe("BTFL 25.12.5 (MSP API 1.47) (copter)");
    expect(e.isDirectFc).toBe(true);
    expect(e.profile).toBe("drone");
    // No LAN / cloud identity for a direct connection.
    expect(e.apiKey).toBe("");
    expect(e.convexId).toBeUndefined();
    expect(e.isLocal).toBe(false);
    // FC flavor for the sidebar badge.
    expect(e.fcFirmware).toBe("betaflight");
    expect(e.frameType).toBe("copter");
    expect(e.fcConnected).toBe(true);
  });

  it("reports the transport connected state on fcConnected/transportOpen", () => {
    const e = adaptDirectFc(
      managedFc({ protocol: { isConnected: false } as ManagedDrone["protocol"] }),
    );
    expect(e.fcConnected).toBe(false);
    expect(e.transportOpen).toBe(false);
  });
});

describe("mergeFleetWithDirectFcs", () => {
  it("appends a direct FC that owns its row and skips an agent-attached FC", () => {
    const paired = [nodeEntry()];
    const merged = mergeFleetWithDirectFcs(paired, [
      managedFc({ id: "fc:direct" }),
      managedFc({ id: "node:agentdev", ownsFleetRow: false }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((n) => n._id)).toEqual(["node:dev", "fc:direct"]);
  });

  it("returns the same paired array reference when there are no direct FCs", () => {
    const paired = [nodeEntry()];
    expect(mergeFleetWithDirectFcs(paired, [])).toBe(paired);
  });

  it("skips a direct FC whose id collides with an existing paired row", () => {
    const paired = [nodeEntry()]; // _id === "node:dev"
    const merged = mergeFleetWithDirectFcs(paired, [
      // A mis-tagged agent FC (ownsFleetRow true) that shares a paired id must
      // not produce a duplicate row (nor a duplicate React key).
      managedFc({ id: "node:dev", ownsFleetRow: true }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]._id).toBe("node:dev");
  });
});

describe("mergeRelayedNodes", () => {
  it("returns the base array reference when there are no relayed nodes", () => {
    const base = [nodeEntry()];
    expect(mergeRelayedNodes(base, {})).toBe(base);
  });

  it("adds a relayed-only drone as its own row with the reach hop", () => {
    const merged = mergeRelayedNodes([], {
      "node:drone-a": relayedEntry(),
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]._id).toBe("node:drone-a");
    expect(merged[0].isRelayed).toBe(true);
    expect(merged[0].reachedVia).toBe("node:gs-1");
    // A relayed-only drone has no direct LAN credentials.
    expect(merged[0].apiKey).toBe("");
  });

  it("a node seen relayed-then-direct is ONE row: the direct row upgraded in place", () => {
    // The directly-paired row (node:drone-a) and the relayed registry entry for
    // the same deviceId collapse to one row. The direct row keeps its LAN
    // identity and takes reach precedence (isRelayed stays false) while carrying
    // the relay hop as secondary provenance.
    const direct = nodeEntry({
      _id: "node:drone-a",
      deviceId: "drone-a",
      apiKey: "lan-key",
      isLocal: true,
    });
    const merged = mergeRelayedNodes([direct], {
      "node:drone-a": relayedEntry({
        deviceId: "drone-a",
        sources: ["relayed", "local"],
      }),
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]._id).toBe("node:drone-a");
    // Direct reach is primary...
    expect(merged[0].apiKey).toBe("lan-key");
    expect(merged[0].isRelayed).toBeUndefined();
    // ...and the relay hop rides along as provenance.
    expect(merged[0].reachedVia).toBe("node:gs-1");
    // The base row was not mutated in place.
    expect(direct.reachedVia).toBeUndefined();
  });

  it("ignores non-relayed registry entries", () => {
    const localOnly: NodeEntry = {
      ...relayedEntry({ deviceId: "drone-b" }),
      presence: {
        ...relayedEntry({ deviceId: "drone-b" }).presence,
        sources: ["local"],
        reachedVia: undefined,
      },
    };
    expect(mergeRelayedNodes([], { "node:drone-b": localOnly })).toEqual([]);
  });
});

describe("adaptRelayed", () => {
  it("mints the canonical node id so a later direct pair collapses onto it", () => {
    const entry = adaptRelayed(relayedEntry({ deviceId: "drone-a" }));
    expect(entry._id).toBe("node:drone-a");
    expect(entry.deviceId).toBe("drone-a");
    expect(entry.profile).toBe("drone");
    expect(entry.lastSeen).toBe(100);
  });
});

describe("droneLiveness for a direct FC", () => {
  it("is always live regardless of lastSeen (live-by-presence)", () => {
    // A stale pair-time timestamp would read offline for a normal node...
    expect(droneLiveness(nodeEntry({ lastSeen: 1 }))).toBe("offline");
    // ...but a direct FC is live while it is present in the fleet list.
    expect(
      droneLiveness(nodeEntry({ lastSeen: 1, isDirectFc: true })),
    ).toBe("live");
  });
});
