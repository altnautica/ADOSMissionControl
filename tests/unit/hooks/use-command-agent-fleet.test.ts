/**
 * Tests for `useCommandAgentFleet`. Focus: the ground-station video guard.
 *
 * A ground station receives its video downlink over the WFB radio, so when
 * the radio link is not connected no video can be flowing. The hook must not
 * report the video state as "live"/"queued" (and must not produce a WHEP URL)
 * for a ground station whose radio link is down, even if a stale videoState
 * arrives from the agent. A drone streams its own camera independently of the
 * WFB radio and must never be gated by this rule.
 */

import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  useCommandAgentFleet,
  groundStationsFunneledUnderDrone,
} from "@/hooks/use-command-agent-fleet";
import {
  useCommandFleetStore,
  type CommandCloudStatus,
} from "@/stores/command-fleet-store";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

const NOW = Date.now();

function makePaired(
  overrides: Partial<FleetNodeEntry> & Pick<FleetNodeEntry, "deviceId">,
): FleetNodeEntry {
  return {
    _id: `id-${overrides.deviceId}`,
    userId: "user-1",
    name: overrides.deviceId,
    apiKey: "key",
    pairedAt: NOW,
    lastSeen: NOW,
    profile: "drone",
    isLocal: false,
    ...overrides,
  };
}

function makeStatus(
  overrides: Partial<CommandCloudStatus> & Pick<CommandCloudStatus, "deviceId">,
): CommandCloudStatus {
  return {
    updatedAt: NOW,
    lastIp: "192.168.1.50",
    videoState: "running",
    videoWhepPort: 8889,
    ...overrides,
  };
}

function seed(rows: CommandCloudStatus[]): void {
  useCommandFleetStore.getState().setCloudStatuses(rows);
}

afterEach(() => {
  useCommandFleetStore.getState().clear();
});

describe("useCommandAgentFleet — ground-station video guard", () => {
  it("does not report video as live when a ground station's radio link is down", () => {
    const drone = makePaired({
      deviceId: "gs-1",
      profile: "ground-station",
      role: "direct",
    });
    seed([
      makeStatus({
        deviceId: "gs-1",
        // Agent (incorrectly) still claims video is running...
        videoState: "running",
        videoWhepUrl: "http://192.168.1.50:8889/main/whep",
        // ...but the WFB receive link is down.
        radio: { state: "disconnected" },
      }),
    ]);

    // The UI has the tile "active" (in the active set). The guard must
    // still refuse to mark the link as streamable.
    const { result } = renderHook(() =>
      useCommandAgentFleet([drone], new Set(["gs-1"]), new Set()),
    );

    const agent = result.current.find((a) => a.identity.deviceId === "gs-1");
    expect(agent).toBeDefined();
    expect(agent!.radio?.state).toBe("disconnected");
    // Video must be neither live nor queued, and no WHEP URL is produced.
    expect(agent!.video.state).not.toBe("live");
    expect(agent!.video.state).not.toBe("queued");
    expect(agent!.video.state).toBe("unavailable");
    expect(agent!.video.whepUrl).toBeNull();
    expect(agent!.video.queued).toBe(false);
  });

  it("reports video as live for a ground station when the radio link is connected", () => {
    const drone = makePaired({
      deviceId: "gs-2",
      profile: "ground-station",
      role: "direct",
    });
    seed([
      makeStatus({
        deviceId: "gs-2",
        lastIp: "192.168.1.51",
        videoState: "running",
        videoWhepUrl: "http://192.168.1.51:8889/main/whep",
        radio: { state: "connected" },
      }),
    ]);

    const { result } = renderHook(() =>
      useCommandAgentFleet([drone], new Set(["gs-2"]), new Set()),
    );

    const agent = result.current.find((a) => a.identity.deviceId === "gs-2");
    expect(agent).toBeDefined();
    expect(agent!.radio?.state).toBe("connected");
    expect(agent!.video.state).toBe("live");
    expect(agent!.video.whepUrl).toBe("http://192.168.1.51:8889/main/whep");
  });

  it("leaves a drone profile unaffected by the radio-link gate", () => {
    // A drone streams its own camera over LAN/WebRTC, independent of WFB.
    // Even with no radio block at all, its video must still be live.
    const drone = makePaired({
      deviceId: "drone-1",
      profile: "drone",
    });
    seed([
      makeStatus({
        deviceId: "drone-1",
        lastIp: "192.168.1.60",
        videoState: "running",
        videoWhepUrl: "http://192.168.1.60:8889/main/whep",
        radio: null,
      }),
    ]);

    const { result } = renderHook(() =>
      useCommandAgentFleet([drone], new Set(["drone-1"]), new Set()),
    );

    const agent = result.current.find((a) => a.identity.deviceId === "drone-1");
    expect(agent).toBeDefined();
    expect(agent!.video.state).toBe("live");
    expect(agent!.video.whepUrl).toBe("http://192.168.1.60:8889/main/whep");
  });

  it("does not gate a drone even when it carries a disconnected radio block", () => {
    const drone = makePaired({
      deviceId: "drone-2",
      profile: "drone",
    });
    seed([
      makeStatus({
        deviceId: "drone-2",
        lastIp: "192.168.1.61",
        videoState: "running",
        videoWhepUrl: "http://192.168.1.61:8889/main/whep",
        radio: { state: "disconnected" },
      }),
    ]);

    const { result } = renderHook(() =>
      useCommandAgentFleet([drone], new Set(["drone-2"]), new Set()),
    );

    const agent = result.current.find((a) => a.identity.deviceId === "drone-2");
    expect(agent).toBeDefined();
    expect(agent!.video.state).toBe("live");
    expect(agent!.video.whepUrl).toBe("http://192.168.1.61:8889/main/whep");
  });
});

const FUNNELED_URL = "http://192.168.1.50:8889/main/whep";

/** A relayed drone's funneled feed row points at the ground node's WHEP with no
 * direct reach of its own (no lastIp), so it resolves to the funneled URL. */
function funneledRow(deviceId: string): CommandCloudStatus {
  return makeStatus({
    deviceId,
    lastIp: undefined,
    videoState: "running",
    videoWhepUrl: FUNNELED_URL,
  });
}

describe("groundStationsFunneledUnderDrone", () => {
  it("flags a ground node whose relayed drone resolves to a playable funneled feed", () => {
    const funneled = groundStationsFunneledUnderDrone(
      [
        makePaired({ deviceId: "gs-1", profile: "ground-station" }),
        makePaired({
          deviceId: "drone-a",
          profile: "drone",
          isRelayed: true,
          reachedVia: "node:gs-1",
        }),
      ],
      {
        "gs-1": makeStatus({ deviceId: "gs-1", radio: { state: "connected" } }),
        "drone-a": funneledRow("drone-a"),
      },
    );
    expect([...funneled]).toEqual(["gs-1"]);
  });

  it("does not flag a ground node when its relayed drone has no playable feed", () => {
    // Ground link down → the relayed drone carries no playable feed, so there is
    // nothing under the drone to duplicate.
    const funneled = groundStationsFunneledUnderDrone(
      [
        makePaired({ deviceId: "gs-1", profile: "ground-station" }),
        makePaired({
          deviceId: "drone-a",
          profile: "drone",
          isRelayed: true,
          reachedVia: "node:gs-1",
        }),
      ],
      {
        "gs-1": makeStatus({ deviceId: "gs-1" }),
        "drone-a": makeStatus({ deviceId: "drone-a", videoState: "stopped" }),
      },
    );
    expect(funneled.size).toBe(0);
  });

  it("ignores a directly-paired drone that carries relay provenance but is not relay-only", () => {
    const funneled = groundStationsFunneledUnderDrone(
      [
        makePaired({ deviceId: "gs-1", profile: "ground-station" }),
        makePaired({
          deviceId: "drone-a",
          profile: "drone",
          isRelayed: false,
          reachedVia: "node:gs-1",
        }),
      ],
      { "gs-1": makeStatus({ deviceId: "gs-1" }), "drone-a": funneledRow("drone-a") },
    );
    expect(funneled.size).toBe(0);
  });
});

describe("useCommandAgentFleet — funneled-feed dedup", () => {
  afterEach(() => {
    useCommandFleetStore.getState().clear();
  });

  it("suppresses the ground station's own tile while showing the funneled feed under the drone", () => {
    const gs = makePaired({
      deviceId: "gs-1",
      profile: "ground-station",
      role: "direct",
    });
    const drone = makePaired({
      deviceId: "drone-a",
      profile: "drone",
      isRelayed: true,
      reachedVia: "node:gs-1",
    });
    seed([
      // Ground station: radio up + its own downlink streaming (its only video).
      makeStatus({
        deviceId: "gs-1",
        radio: { state: "connected" },
        videoWhepUrl: FUNNELED_URL,
      }),
      // The same stream funneled under the relayed drone.
      funneledRow("drone-a"),
    ]);

    const { result } = renderHook(() =>
      useCommandAgentFleet([gs, drone], new Set(), new Set()),
    );

    const gsAgent = result.current.find((a) => a.identity.deviceId === "gs-1");
    const droneAgent = result.current.find((a) => a.identity.deviceId === "drone-a");

    // The feed shows exactly once: under the drone, not doubled under the GS.
    expect(gsAgent!.video.whepUrl).toBeNull();
    expect(droneAgent!.video.whepUrl).toBe(FUNNELED_URL);
  });

  it("keeps the ground station's own tile when no relayed drone funnels its feed", () => {
    const gs = makePaired({
      deviceId: "gs-1",
      profile: "ground-station",
      role: "direct",
    });
    seed([
      makeStatus({
        deviceId: "gs-1",
        radio: { state: "connected" },
        videoWhepUrl: FUNNELED_URL,
      }),
    ]);

    const { result } = renderHook(() =>
      useCommandAgentFleet([gs], new Set(), new Set()),
    );

    const gsAgent = result.current.find((a) => a.identity.deviceId === "gs-1");
    expect(gsAgent!.video.whepUrl).toBe(FUNNELED_URL);
  });
});
