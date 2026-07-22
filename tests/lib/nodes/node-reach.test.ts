/**
 * Tests for the board's reach descriptor and row join: which reach kind a node
 * resolves to, whether that reach can carry a command, and whether a result
 * from it is the vehicle's answer or only a queue receipt.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// local-nodes-store is persisted; bind an in-memory localStorage before import.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import { describeNodeReach } from "@/lib/nodes/node-reach";
import { joinNodeRows, nodeMatchesQuery } from "@/lib/nodes/node-rows";
import type { CloudCommandEnqueuer } from "@/lib/nodes/command-sink";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";

const DEVICE_ID = "device-alpha";

function lanNode(deviceId: string): LocalNode {
  return {
    deviceId,
    name: "Alpha",
    hostname: "http://alpha.example:8080",
    apiKey: "key-alpha",
    profile: "drone",
    pairedAt: 1,
  } as LocalNode;
}

const enqueue: CloudCommandEnqueuer = async () => ({ commandId: "cmd-1" });

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
});

describe("describeNodeReach", () => {
  it("prefers the LAN lane and reports it carries the vehicle's answer", () => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });

    const reach = describeNodeReach(
      { deviceId: DEVICE_ID, convexId: "row-alpha" },
      { enqueueCloudCommand: enqueue, originIsHttps: false },
    );

    expect(reach.kind).toBe("lan");
    expect(reach.commandable).toBe(true);
    expect(reach.reportsVehicleAck).toBe(true);
    expect(reach.sink).not.toBeNull();
  });

  it("falls back to the queue and says a result is only a receipt", () => {
    const reach = describeNodeReach(
      { deviceId: DEVICE_ID, convexId: "row-alpha" },
      { enqueueCloudCommand: enqueue, originIsHttps: false },
    );

    expect(reach.kind).toBe("cloud");
    expect(reach.commandable).toBe(true);
    // The queue accepts the command; the vehicle has not seen it yet.
    expect(reach.reportsVehicleAck).toBe(false);
  });

  it("keeps a directly connected board as its own kind, not a blanket failure", () => {
    const reach = describeNodeReach(
      { deviceId: "fc:123", isDirectFc: true },
      { enqueueCloudCommand: enqueue, originIsHttps: false },
    );

    // It is plugged into this browser, so "unreachable" would be a lie — but it
    // has no agent behind it, so the agent command lane genuinely cannot carry.
    expect(reach.kind).toBe("direct-fc");
    expect(reach.commandable).toBe(false);
    expect(reach.blockedReason).toBe("direct-fc");
    expect(reach.sink).toBeNull();
  });

  it("names the HTTPS block rather than reporting an unpaired node", () => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });

    const reach = describeNodeReach(
      { deviceId: DEVICE_ID },
      { enqueueCloudCommand: enqueue, originIsHttps: true },
    );

    expect(reach.kind).toBe("none");
    expect(reach.blockedReason).toBe("lan-blocked-by-https");
    expect(reach.commandable).toBe(false);
  });

  it("reports an unpaired node as unreachable with no command surface", () => {
    const reach = describeNodeReach(
      { deviceId: "device-unknown" },
      { originIsHttps: false },
    );

    expect(reach.kind).toBe("none");
    expect(reach.blockedReason).toBe("not-paired");
    expect(reach.sink).toBeNull();
  });
});

function node(deviceId: string, name: string): FleetNodeEntry {
  return {
    _id: `node:${deviceId}`,
    userId: "local",
    deviceId,
    name,
    apiKey: "",
    pairedAt: 1,
    profile: "drone",
    isLocal: true,
    board: "Reference Board",
  } as FleetNodeEntry;
}

function summary(deviceId: string, name: string): CommandAgentSummary {
  return {
    identity: { id: `node:${deviceId}`, deviceId, name },
    profile: "drone",
    role: null,
    radio: null,
    liveness: "live",
    lastSeen: 1,
    system: {
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      temperature: null,
      fcConnected: false,
      serviceCount: 0,
      runningServiceCount: 0,
    },
    video: {
      state: "unavailable",
      agentState: "unknown",
      whepUrl: null,
      active: false,
      queued: false,
    },
    telemetry: {
      armed: null,
      mode: null,
      batteryRemaining: null,
      batteryVoltage: null,
      gpsSatellites: null,
      gpsFixType: null,
      altitudeRel: null,
      groundspeed: null,
    },
  };
}

describe("joinNodeRows", () => {
  it("keeps the summary ordering, not the membership ordering", () => {
    const nodes = [node("a", "Alpha"), node("b", "Bravo")];
    const rows = joinNodeRows(nodes, [summary("b", "Bravo"), summary("a", "Alpha")]);

    expect(rows.map((r) => r.node.deviceId)).toEqual(["b", "a"]);
  });

  it("drops a summary with no membership entry rather than half-filling a row", () => {
    const rows = joinNodeRows([node("a", "Alpha")], [summary("ghost", "Ghost")]);
    expect(rows).toHaveLength(0);
  });
});

describe("nodeMatchesQuery", () => {
  const entry = node("device-alpha", "Alpha One");

  it("matches on name, device id and board, case-insensitively", () => {
    expect(nodeMatchesQuery(entry, "alpha one")).toBe(true);
    expect(nodeMatchesQuery(entry, "DEVICE-ALPHA")).toBe(true);
    expect(nodeMatchesQuery(entry, "reference")).toBe(true);
  });

  it("treats a blank query as matching everything", () => {
    expect(nodeMatchesQuery(entry, "   ")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(nodeMatchesQuery(entry, "bravo")).toBe(false);
  });
});
