/**
 * @license GPL-3.0-only
 *
 * Tests for the pure transitive-enrollment planner: turning a ground node's
 * reported WFB peers into relayed-drone enrollment intents, gating the funneled
 * feed on the ground link (Rule 44), and deduping against a direct pair so a
 * later direct pair upgrades the row in place rather than double-registering.
 */

import { describe, it, expect } from "vitest";

import {
  extractLinkedPeers,
  planRelayedEnrollment,
  type RelayGroundNode,
} from "../relayed-peers";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";

const NOW = 1_700_000_000_000;

function gsStatus(over: Partial<CommandCloudStatus> = {}): CommandCloudStatus {
  return { deviceId: "gs-1", updatedAt: NOW, ...over };
}

function ground(over: Partial<RelayGroundNode> = {}): RelayGroundNode {
  return {
    deviceId: "gs-1",
    nodeId: "node:gs-1",
    status: gsStatus(),
    radioUp: true,
    ...over,
  };
}

describe("extractLinkedPeers", () => {
  it("prefers the linkedPeers[] list when present", () => {
    const peers = extractLinkedPeers(
      gsStatus({
        peerDeviceId: "scalar",
        linkedPeers: [
          { deviceId: "drone-a", rssiDbm: -51 },
          { deviceId: "drone-b", rssiDbm: -63 },
        ],
      }),
    );
    expect(peers.map((p) => p.deviceId)).toEqual(["drone-a", "drone-b"]);
  });

  it("falls back to the scalar peerDeviceId when there is no list", () => {
    const peers = extractLinkedPeers(
      gsStatus({ peerDeviceId: "drone-a", peerRssiDbm: -51 }),
    );
    expect(peers).toEqual([{ deviceId: "drone-a", rssiDbm: -51 }]);
  });

  it("drops list entries with no device id", () => {
    const peers = extractLinkedPeers(
      gsStatus({
        linkedPeers: [{ deviceId: "" }, { deviceId: "drone-a" }],
      }),
    );
    expect(peers.map((p) => p.deviceId)).toEqual(["drone-a"]);
  });

  it("is empty when there is no peer at all", () => {
    expect(extractLinkedPeers(gsStatus())).toEqual([]);
    expect(extractLinkedPeers(undefined)).toEqual([]);
  });
});

describe("planRelayedEnrollment", () => {
  it("enrolls a WFB-linked drone reached through the ground node", () => {
    const [e] = planRelayedEnrollment({
      groundNodes: [ground({ status: gsStatus({ peerDeviceId: "drone-a", peerRssiDbm: -51 }) })],
      directlyPairedDeviceIds: new Set(),
      now: NOW,
    });
    expect(e.nodeId).toBe("node:drone-a");
    expect(e.deviceId).toBe("drone-a");
    expect(e.reachedVia).toBe("node:gs-1");
    expect(e.peerRssiDbm).toBe(-51);
  });

  it("registers the funneled feed under the drone while the ground link is up", () => {
    const [e] = planRelayedEnrollment({
      groundNodes: [
        ground({
          status: gsStatus({
            peerDeviceId: "drone-a",
            peerRssiDbm: -51,
            videoState: "running",
            lastIp: "192.168.1.50",
            videoWhepPort: 8889,
          }),
          radioUp: true,
        }),
      ],
      directlyPairedDeviceIds: new Set(),
      now: NOW,
    });
    // The drone's stream shows under the DRONE node, pointing at the ground
    // node's WHEP (the drone has no direct reach), and its peer is the GS.
    expect(e.funneledStatus?.deviceId).toBe("drone-a");
    expect(e.funneledStatus?.peerDeviceId).toBe("gs-1");
    expect(e.funneledStatus?.videoState).toBe("running");
    expect(e.funneledStatus?.videoWhepUrl).toBe(
      "http://192.168.1.50:8889/main/whep",
    );
  });

  it("shows NO funneled video when the ground link is not verified up (Rule 44)", () => {
    const [e] = planRelayedEnrollment({
      groundNodes: [
        ground({
          status: gsStatus({
            peerDeviceId: "drone-a",
            videoState: "running",
            lastIp: "192.168.1.50",
          }),
          radioUp: false,
        }),
      ],
      directlyPairedDeviceIds: new Set(),
      now: NOW,
    });
    expect(e.funneledStatus?.videoState).toBeUndefined();
    expect(e.funneledStatus?.videoWhepUrl).toBeUndefined();
  });

  it("enrolls the relay link but withholds the funneled status when the drone is ALSO paired directly", () => {
    // Dedup / upgrade-in-place: a directly-paired drone owns its own status via
    // its own bridge, so the relay must not clobber the direct video/telemetry —
    // but the relay link is still recorded (the row carries both reaches).
    const [e] = planRelayedEnrollment({
      groundNodes: [
        ground({
          status: gsStatus({
            peerDeviceId: "drone-a",
            videoState: "running",
            lastIp: "192.168.1.50",
          }),
        }),
      ],
      directlyPairedDeviceIds: new Set(["drone-a"]),
      now: NOW,
    });
    expect(e.nodeId).toBe("node:drone-a");
    expect(e.reachedVia).toBe("node:gs-1");
    expect(e.funneledStatus).toBeUndefined();
  });

  it("never enrolls a ground node as its own relayed peer", () => {
    const out = planRelayedEnrollment({
      groundNodes: [ground({ status: gsStatus({ peerDeviceId: "gs-1" }) })],
      directlyPairedDeviceIds: new Set(),
      now: NOW,
    });
    expect(out).toHaveLength(0);
  });

  it("deduplicates a peer reported by two ground nodes (first wins)", () => {
    const out = planRelayedEnrollment({
      groundNodes: [
        ground({
          deviceId: "gs-1",
          nodeId: "node:gs-1",
          status: gsStatus({ deviceId: "gs-1", peerDeviceId: "drone-a" }),
        }),
        ground({
          deviceId: "gs-2",
          nodeId: "node:gs-2",
          status: gsStatus({ deviceId: "gs-2", peerDeviceId: "drone-a" }),
        }),
      ],
      directlyPairedDeviceIds: new Set(),
      now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0].reachedVia).toBe("node:gs-1");
  });

  it("dates the enrollment from the peer's seen-at when present", () => {
    const seenAtUnix = 1_699_999_000; // seconds
    const [e] = planRelayedEnrollment({
      groundNodes: [
        ground({
          status: gsStatus({
            linkedPeers: [{ deviceId: "drone-a", seenAtUnix }],
          }),
        }),
      ],
      directlyPairedDeviceIds: new Set(),
      now: NOW,
    });
    expect(e.lastHeartbeat).toBe(seenAtUnix * 1000);
  });
});
