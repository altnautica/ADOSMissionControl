/**
 * @module hooks/use-fleet-config-write.test
 * @description A fleet directive is a config write fanned across a selection,
 * and the whole point of the fan-out is that every node resolves its OWN
 * transport. The dangerous bug is the cheap one: reuse the attached direct
 * client for all N and report N successes while only the focused node was ever
 * written. That, plus the per-node outcome reporting an unreachable or
 * rejecting node must produce, is what these pin.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { LocalNode } from "@/stores/local-nodes-store";
import type { PairedDrone } from "@/stores/pairing-store";
import type {
  AgentConfigClient,
  ConfigWriteResult,
} from "@/lib/agent/config-access";
import {
  resolveFleetConfigAccess,
  resolveFleetConfigTargets,
  writeConfigForNodes,
  type FleetConfigTransport,
} from "../use-fleet-config-write";

function localNode(deviceId: string, hostname: string): LocalNode {
  return {
    deviceId,
    name: deviceId,
    hostname,
    apiKey: `key-${deviceId}`,
    profile: "drone",
    pairedAt: 0,
  };
}

/** A direct client that records every write it is handed. */
function recordingClient(): AgentConfigClient & {
  writes: Array<[string, string]>;
} {
  const writes: Array<[string, string]> = [];
  return {
    writes,
    getConfig: async () => ({}),
    setConfigValue: async (key: string, value: string) => {
      writes.push([key, value]);
      return {} as ConfigWriteResult;
    },
  };
}

function transportWith(
  client: AgentConfigClient | null,
  focusedDeviceId: string | null,
  localNodes: LocalNode[],
  pairedDrones: PairedDrone[] = [],
): FleetConfigTransport {
  return { client, focusedDeviceId, records: { localNodes, pairedDrones } };
}

describe("resolveFleetConfigAccess", () => {
  const client = recordingClient();
  const transport = transportWith(client, "focused", [
    localNode("focused", "10.0.0.1"),
    localNode("peer", "10.0.0.2"),
  ]);

  it("hands the direct client only to the node it is attached to", () => {
    expect(resolveFleetConfigAccess("focused", transport)).toEqual({
      mode: "direct",
      client,
    });
  });

  it("routes every other node through its own pairing record", () => {
    const access = resolveFleetConfigAccess("peer", transport);
    expect(access.mode).toBe("proxy");
    if (access.mode !== "proxy") throw new Error("expected proxy");
    expect(access.target.host).toBe("10.0.0.2");
    expect(access.target.apiKey).toBe("key-peer");
  });

  it("reports no path for a node with neither a client nor a record", () => {
    expect(resolveFleetConfigAccess("ghost", transport)).toEqual({
      mode: "none",
      reason: "no-path",
    });
  });
});

describe("resolveFleetConfigTargets", () => {
  it("returns the reachable subset, deduped, for the pre-commit count", () => {
    const transport = transportWith(recordingClient(), "focused", [
      localNode("focused", "10.0.0.1"),
      localNode("peer", "10.0.0.2"),
    ]);
    expect(
      resolveFleetConfigTargets(
        ["focused", "peer", "peer", "ghost"],
        transport,
      ),
    ).toEqual(["focused", "peer"]);
  });

  it("counts nobody when no client is attached and nothing is paired", () => {
    expect(
      resolveFleetConfigTargets(["a", "b"], transportWith(null, null, [])),
    ).toEqual([]);
  });
});

describe("writeConfigForNodes", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function okProxy() {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: "k", value: "v" }),
    };
  }

  it("writes each node over its own transport, not the focused client N times", async () => {
    const client = recordingClient();
    fetchMock.mockResolvedValue(okProxy());
    const transport = transportWith(client, "focused", [
      localNode("focused", "10.0.0.1"),
      localNode("peer-a", "10.0.0.2"),
      localNode("peer-b", "10.0.0.3"),
    ]);

    const res = await writeConfigForNodes(
      "swarm.default_formation",
      "wedge",
      ["focused", "peer-a", "peer-b"],
      transport,
    );

    expect(res.applied).toBe(3);
    expect(res.failed).toBe(0);
    // The direct client saw exactly ONE write — its own node.
    expect(client.writes).toEqual([["swarm.default_formation", "wedge"]]);
    // The other two went out over the proxy, each addressed to its own host.
    const hosts = fetchMock.mock.calls.map(
      (c) => JSON.parse(String((c[1] as RequestInit).body)).host,
    );
    expect(hosts.sort()).toEqual(["10.0.0.2", "10.0.0.3"]);
    expect(res.outcomes.map((o) => o.mode).sort()).toEqual([
      "direct",
      "proxy",
      "proxy",
    ]);
  });

  it("reports an unreachable node as a failure instead of skipping it", async () => {
    const transport = transportWith(recordingClient(), "focused", [
      localNode("focused", "10.0.0.1"),
    ]);

    const res = await writeConfigForNodes(
      "swarm.mode",
      "formation",
      ["focused", "ghost"],
      transport,
    );

    expect(res.applied).toBe(1);
    expect(res.failed).toBe(1);
    const ghost = res.outcomes.find((o) => o.deviceId === "ghost");
    expect(ghost).toMatchObject({ ok: false, mode: "none" });
    expect(ghost?.error).toBeTruthy();
  });

  it("treats a 200 carrying an {error} body as a rejection, not a success", async () => {
    const rejecting: AgentConfigClient = {
      getConfig: async () => ({}),
      setConfigValue: async () => ({ error: "unknown formation" }),
    };
    const res = await writeConfigForNodes(
      "swarm.default_formation",
      "diamond",
      ["focused"],
      transportWith(rejecting, "focused", []),
    );

    expect(res.applied).toBe(0);
    expect(res.outcomes[0]).toEqual({
      deviceId: "focused",
      mode: "direct",
      ok: false,
      error: "unknown formation",
    });
  });

  it("keeps one node's thrown transport error from aborting the rest", async () => {
    const client = recordingClient();
    fetchMock.mockRejectedValue(new Error("connection refused"));
    const transport = transportWith(client, "focused", [
      localNode("focused", "10.0.0.1"),
      localNode("peer", "10.0.0.2"),
    ]);

    const res = await writeConfigForNodes(
      "swarm.mode",
      "hold",
      ["focused", "peer"],
      transport,
    );

    expect(res.applied).toBe(1);
    expect(res.outcomes.find((o) => o.deviceId === "peer")).toEqual({
      deviceId: "peer",
      mode: "proxy",
      ok: false,
      error: "connection refused",
    });
    // The reachable node still got its write.
    expect(client.writes).toEqual([["swarm.mode", "hold"]]);
  });

  it("writes a repeated device id once", async () => {
    const client = recordingClient();
    const res = await writeConfigForNodes(
      "swarm.mode",
      "flocking",
      ["focused", "focused"],
      transportWith(client, "focused", []),
    );
    expect(res.outcomes).toHaveLength(1);
    expect(client.writes).toHaveLength(1);
  });
});
