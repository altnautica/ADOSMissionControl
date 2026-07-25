/**
 * @license GPL-3.0-only
 *
 * Regression for the LAN half of local-first transitive enrollment. A
 * `/api/status/full` response carrying the agent's snake_case `linked_peers`
 * must map onto the CommandCloudStatus `LinkedPeer` shape (crucially
 * `seen_at_unix` -> `seenAtUnix`, the freshness key), and, fed through the
 * enrollment planner, produce a relayed-drone enrollment. This is the
 * end-to-end proof that the primary (no-cloud-relay) path enrolls: the mapper
 * and the planner agree on the peer key set, so a wrong key mapping would
 * surface here as a dropped peer or a lost seen-at.
 */

import { describe, it, expect } from "vitest";

import { mapFullStatusToCloudStatus } from "../full-status-to-cloud-status";
import { planRelayedEnrollment } from "../relayed-peers";
import type { FullStatusResponse } from "../types";

const SEEN_AT_UNIX = 1_699_999_000; // seconds

/** A minimal, fully-typed `/api/status/full` body carrying only what the mapper
 * reads plus the WFB peer list under test. */
function fullStatus(
  linkedPeers: FullStatusResponse["linked_peers"],
): FullStatusResponse {
  return {
    version: "1.2.3",
    uptime_seconds: 42,
    board: {
      name: "Reference",
      model: "Reference",
      tier: 1,
      ram_mb: 1024,
      cpu_cores: 4,
      vendor: "Reference",
      soc: "test",
      arch: "aarch64",
      hw_video_codecs: [],
    },
    health: {
      cpu_percent: 0,
      memory_percent: 0,
      disk_percent: 0,
      temperature: null,
      timestamp: "",
    },
    fc_connected: false,
    fc_port: "",
    fc_baud: 0,
    services: [],
    resources: {
      cpu_percent: 0,
      memory_percent: 0,
      disk_percent: 0,
      temperature: null,
    },
    video: { state: "stopped", whep_url: null },
    telemetry: {},
    linked_peers: linkedPeers,
  };
}

const groundNode = {
  deviceId: "gs-1",
  mdnsHost: undefined,
  lastIp: "10.0.0.5",
  name: "Ground Station",
};

describe("mapFullStatusToCloudStatus — linked_peers", () => {
  it("maps the snake_case linked_peers onto the LinkedPeer shape (seen_at_unix -> seenAtUnix)", () => {
    const status = mapFullStatusToCloudStatus(
      fullStatus([
        {
          device_id: "drone-a",
          rssi_dbm: -51,
          role: "drone",
          channel: 149,
          seen_at_unix: SEEN_AT_UNIX,
        },
      ]),
      groundNode,
    );

    expect(status.linkedPeers).toEqual([
      {
        deviceId: "drone-a",
        rssiDbm: -51,
        role: "drone",
        channel: 149,
        seenAtUnix: SEEN_AT_UNIX,
      },
    ]);
  });

  it("drops a peer entry with no device_id", () => {
    const status = mapFullStatusToCloudStatus(
      fullStatus([{ device_id: "" }, { device_id: "drone-a" }]),
      groundNode,
    );
    expect(status.linkedPeers?.map((p) => p.deviceId)).toEqual(["drone-a"]);
  });

  it("leaves linkedPeers undefined when the agent omits the list", () => {
    const status = mapFullStatusToCloudStatus(fullStatus(undefined), groundNode);
    expect(status.linkedPeers).toBeUndefined();
  });

  it("feeds the enrollment planner end-to-end so the relayed drone enrolls over the LAN (no cloud relay)", () => {
    // The exact primary-path chain: map the agent's LAN status, then plan the
    // transitive enrollment from the mapped status. The seenAtUnix -> the
    // enrollment's lastHeartbeat (the relay freshness signal) is the key that
    // would break silently if the mapper and planner disagreed on the wire key.
    const gsStatus = mapFullStatusToCloudStatus(
      fullStatus([
        { device_id: "drone-a", rssi_dbm: -51, seen_at_unix: SEEN_AT_UNIX },
      ]),
      groundNode,
    );

    const [enrollment] = planRelayedEnrollment({
      groundNodes: [
        {
          deviceId: "gs-1",
          nodeId: "node:gs-1",
          status: gsStatus,
          radioUp: true,
        },
      ],
      directlyPairedDeviceIds: new Set(),
    });

    expect(enrollment.deviceId).toBe("drone-a");
    expect(enrollment.reachedVia).toBe("node:gs-1");
    expect(enrollment.peerRssiDbm).toBe(-51);
    expect(enrollment.lastHeartbeat).toBe(SEEN_AT_UNIX * 1000);
  });
});
