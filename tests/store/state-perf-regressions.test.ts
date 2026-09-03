/**
 * @license GPL-3.0-only
 *
 * Regression tests for the state/render-performance pass. Each block pins one
 * defect that was live in the tree, phrased so it fails if the fix is reverted:
 *
 *  1. the FC-telemetry write storm — one position packet must not clone the
 *     registry map, must not replace the projected fleet array, and must not
 *     notify subscribers per packet;
 *  2. the telemetry write gate reading a mirror of the selection instead of
 *     its owner, so it could pass for a drone already switched away from;
 *  3. `idCounts` reported as a per-minute rate but accumulated for the session;
 *  4. a coalesced version bump landing after `clear()` and re-notifying
 *     against a freshly reset store;
 *  5. live mission-execution state surviving a reload as if the vehicle were
 *     still flying it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCanMonitorStore } from "@/stores/can-monitor-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import {
  createFleetDronesProjector,
  selectFleetDrones,
} from "@/stores/node-registry/select-fleet-drones";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";
import { createVersionBumper } from "@/stores/coalesced-version";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import {
  useMissionStore,
  missionPartialize,
  migrateMissionStore,
} from "@/stores/mission-store";
import type { PositionData } from "@/lib/types";

const NOW = 1_700_000_000_000;

function pos(lat: number, lon: number): PositionData {
  return {
    lat,
    lon,
    alt: 100,
    relativeAlt: 50,
    heading: 0,
    groundSpeed: 0,
    airSpeed: 0,
    climbRate: 0,
    timestamp: NOW,
  };
}

/** Resolve after the next animation frame, when a coalesced bump applies. */
function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

/** Seed one registry row with an attached FC and a fresh heartbeat. */
function seedNode(nodeId: string, name: string): void {
  const reg = useNodeRegistryStore.getState();
  reg.upsertPresence(
    nodeId,
    { deviceId: nodeId.replace("node:", ""), name, lastHeartbeat: NOW },
    "local",
  );
  reg.attachFc(nodeId, nodeId);
}

// ── 1. the FC-telemetry write storm ──────────────────────────────

describe("node registry FC telemetry does not storm", () => {
  beforeEach(() => {
    useNodeRegistryStore.getState().clear();
  });

  it("mutates the row in place instead of cloning the nodes map", () => {
    seedNode("node:a", "Alpha");
    const before = useNodeRegistryStore.getState().nodes;
    const entryBefore = before["node:a"];

    useNodeRegistryStore
      .getState()
      .updateFcTelemetry("node:a", { position: pos(1, 2) });

    const after = useNodeRegistryStore.getState().nodes;
    // The map and the row keep their identity: a fresh `{...nodes}` per
    // position packet is what re-projected the whole fleet 15-30x/sec.
    expect(after).toBe(before);
    expect(after["node:a"]).toBe(entryBefore);
    // The payload did land.
    expect(after["node:a"].fc.position?.lat).toBe(1);
  });

  it("bumps the row rev so the projection can still invalidate that row", () => {
    seedNode("node:a", "Alpha");
    const rev0 = useNodeRegistryStore.getState().nodes["node:a"].rev;

    useNodeRegistryStore
      .getState()
      .updateFcTelemetry("node:a", { position: pos(1, 2) });

    expect(useNodeRegistryStore.getState().nodes["node:a"].rev).toBe(rev0 + 1);
  });

  it("does not bump rev for a patch that changes nothing", () => {
    seedNode("node:a", "Alpha");
    useNodeRegistryStore.getState().updateFcTelemetry("node:a", {
      flightMode: "AUTO",
    });
    const rev = useNodeRegistryStore.getState().nodes["node:a"].rev;

    useNodeRegistryStore.getState().updateFcTelemetry("node:a", {
      flightMode: "AUTO",
    });

    expect(useNodeRegistryStore.getState().nodes["node:a"].rev).toBe(rev);
  });

  it("coalesces N telemetry writes into ONE store notification per frame", async () => {
    seedNode("node:a", "Alpha");
    let notifications = 0;
    const unsub = useNodeRegistryStore.subscribe(() => {
      notifications++;
    });

    // 20 distinct writes inside one frame — a full MAVLink cycle.
    for (let i = 0; i < 20; i++) {
      useNodeRegistryStore
        .getState()
        .updateFcTelemetry("node:a", { position: pos(1 + i, 2) });
    }
    // Nothing yet: the writes mutated in place and scheduled one bump.
    expect(notifications).toBe(0);

    await nextFrame();
    unsub();

    // Exactly one, not twenty.
    expect(notifications).toBe(1);
  });
});

// ── 1b. projected fleet array identity ───────────────────────────

describe("fleet projection preserves identity", () => {
  beforeEach(() => {
    useNodeRegistryStore.getState().clear();
  });

  it("returns the same array AND the same rows when nothing changed", () => {
    seedNode("node:a", "Alpha");
    seedNode("node:b", "Bravo");
    const project = createFleetDronesProjector();
    const nodes = useNodeRegistryStore.getState().nodes;

    const first = project({ nodes, cloudStatuses: {}, now: NOW });
    const second = project({ nodes, cloudStatuses: {}, now: NOW });

    // Array identity is what `useFleetStore((s) => s.drones)` compares, so a
    // fresh array on an unchanged tick re-rendered all nine consumers.
    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
  });

  it("re-projects only the row whose rev moved", () => {
    seedNode("node:a", "Alpha");
    seedNode("node:b", "Bravo");
    const project = createFleetDronesProjector();
    const nodes = useNodeRegistryStore.getState().nodes;
    const first = project({ nodes, cloudStatuses: {}, now: NOW });

    useNodeRegistryStore
      .getState()
      .updateFcTelemetry("node:a", { position: pos(9, 9) });

    const second = project({
      nodes: useNodeRegistryStore.getState().nodes,
      cloudStatuses: {},
      now: NOW,
    });

    expect(second).not.toBe(first);
    const alphaIdx = first.findIndex((d) => d.name === "Alpha");
    const bravoIdx = first.findIndex((d) => d.name === "Bravo");
    expect(second[alphaIdx]).not.toBe(first[alphaIdx]);
    // Bravo did not move, so its projected row keeps identity and its
    // consumers bail out.
    expect(second[bravoIdx]).toBe(first[bravoIdx]);
  });

  it("agrees with the pure projection", () => {
    seedNode("node:a", "Alpha");
    const nodes = useNodeRegistryStore.getState().nodes;
    const memoized = createFleetDronesProjector()({
      nodes,
      cloudStatuses: {},
      now: NOW,
    });
    expect(memoized).toEqual(selectFleetDrones({ nodes, cloudStatuses: {}, now: NOW }));
  });

  it("notices a removed node even though no surviving row changed", () => {
    seedNode("node:a", "Alpha");
    seedNode("node:b", "Bravo");
    const project = createFleetDronesProjector();
    const first = project({
      nodes: useNodeRegistryStore.getState().nodes,
      cloudStatuses: {},
      now: NOW,
    });
    expect(first).toHaveLength(2);

    useNodeRegistryStore.getState().detachFc("node:b");
    useNodeRegistryStore.getState().dropPresence("node:b", "local");

    const second = project({
      nodes: useNodeRegistryStore.getState().nodes,
      cloudStatuses: {},
      now: NOW,
    });
    expect(second).toHaveLength(1);
    expect(second).not.toBe(first);
  });
});

// ── 3. can-monitor idCounts is a window, not a session total ─────

describe("can-monitor idCounts", () => {
  beforeEach(() => {
    useCanMonitorStore.getState().clear();
    useCanMonitorStore.getState().setEnabled(true);
    vi.useFakeTimers();
  });

  it("drops observations older than the window instead of accumulating forever", () => {
    vi.setSystemTime(NOW);
    const frame = { bus: 0, id: 0x123, len: 8, data: new Uint8Array(8) };
    for (let i = 0; i < 10; i++) {
      useCanMonitorStore.getState().pushFrame({ ...frame, timestamp: NOW });
    }
    expect(useCanMonitorStore.getState().idCounts.get(0x123)).toBe(10);

    // 61 s later the whole first burst is outside the 60 s window.
    vi.setSystemTime(NOW + 61_000);
    useCanMonitorStore
      .getState()
      .pushFrame({ ...frame, timestamp: NOW + 61_000 });

    // A lifetime tally would read 11.
    expect(useCanMonitorStore.getState().idCounts.get(0x123)).toBe(1);
  });

  it("bounds the tracked id set so a 29-bit id flood cannot grow it forever", () => {
    vi.setSystemTime(NOW);
    for (let i = 0; i < 3000; i++) {
      useCanMonitorStore.getState().pushFrame({
        timestamp: NOW,
        bus: 0,
        id: 0x10000000 + i,
        len: 8,
        data: new Uint8Array(8),
      });
    }
    expect(useCanMonitorStore.getState().idCounts.size).toBeLessThanOrEqual(2048);
  });
});

// ── 4. a bump must not land after clear() ────────────────────────

describe("coalesced version bumper", () => {
  it("collapses many schedules into one apply", async () => {
    let applied = 0;
    const b = createVersionBumper(() => {
      applied++;
    });
    for (let i = 0; i < 50; i++) b.scheduleVersionBump();
    expect(applied).toBe(0);
    await nextFrame();
    expect(applied).toBe(1);
  });

  it("cancel drops a pending apply entirely", async () => {
    let applied = 0;
    const b = createVersionBumper(() => {
      applied++;
    });
    b.scheduleVersionBump();
    expect(b.hasPendingBump()).toBe(true);
    b.cancelVersionBump();
    expect(b.hasPendingBump()).toBe(false);
    await nextFrame();
    // Without cancellation this bump lands against the already-reset store.
    expect(applied).toBe(0);
  });

  it("telemetry clear() cancels the bump a same-frame push scheduled", async () => {
    useTelemetryStore.getState().clear();
    const v0 = useTelemetryStore.getState()._version;
    useTelemetryStore.getState().pushPosition(pos(1, 2));
    useTelemetryStore.getState().clear();

    await nextFrame();

    // clear() resets _version to nothing higher; a leaked bump would raise it.
    expect(useTelemetryStore.getState()._version).toBe(v0);
    expect(useTelemetryStore.getState().position.length).toBe(0);
  });

  it("trail clear() cancels its pending bump too", async () => {
    useTrailStore.getState().clear();
    useTrailStore.getState().pushPoint(10, 20, 5);
    useTrailStore.getState().clear();
    await nextFrame();
    expect(useTrailStore.getState()._version).toBe(0);
    expect(useTrailStore.getState()._ring.length).toBe(0);
  });
});

// ── 2. the telemetry write gate reads the OWNER of selection ─────

describe("telemetry write gate ownership", () => {
  it("drone-store no longer carries a selection mirror at all", () => {
    // The mirror was the defect: `drone-manager.selectDrone(null)` skipped the
    // propagation and `clear()` never propagated, so the mirror could name a
    // drone the manager had already deselected — and the bridge gated telemetry
    // on the mirror. Deleting the field is what makes the bug unreachable.
    const state = useDroneStore.getState() as unknown as Record<string, unknown>;
    expect("selectedId" in state).toBe(false);
    expect("selectDrone" in state).toBe(false);
  });

  it("deselecting through the owner is observable — no stale survivor", () => {
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    expect(useDroneManager.getState().selectedDroneId).toBe("drone-a");
    useDroneManager.getState().selectDrone(null);
    // With the mirror in place this read still returned "drone-a".
    expect(useDroneManager.getState().selectedDroneId).toBeNull();
  });

  it("clear() leaves no selection behind", () => {
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    useDroneManager.getState().clear();
    expect(useDroneManager.getState().selectedDroneId).toBeNull();
  });
});

// ── 5. a persisted mission is a plan, never a report ────────────

describe("mission-store persisted shape", () => {
  it("strips live execution state out of the persisted payload", () => {
    useMissionStore.setState({
      activeMission: {
        id: "m1",
        name: "Survey",
        droneId: "drone-a",
        waypoints: [],
        state: "running",
        progress: 62,
        currentWaypoint: 4,
        startedAt: NOW,
      },
      waypoints: [],
    });

    const persisted = missionPartialize(useMissionStore.getState());

    // Restoring `running` put MissionExecutionOverlay and OverviewMap's
    // mission controls on screen after a reload with nothing connected.
    expect(persisted.activeMission?.state).toBe("planning");
    expect(persisted.activeMission?.progress).toBe(0);
    expect(persisted.activeMission?.currentWaypoint).toBe(0);
    expect(persisted.activeMission?.startedAt).toBeUndefined();
    // The plan half survives.
    expect(persisted.activeMission?.id).toBe("m1");
    expect(persisted.activeMission?.name).toBe("Survey");
  });

  it("neutralises a v3 payload that still names a running mission", () => {
    const migrated = migrateMissionStore(
      {
        waypoints: [],
        activeMission: {
          id: "m1",
          name: "Survey",
          droneId: "drone-a",
          waypoints: [],
          state: "running",
          progress: 62,
          currentWaypoint: 4,
          startedAt: NOW,
        },
      },
      3,
    );
    expect(migrated.activeMission?.state).toBe("planning");
    expect(migrated.activeMission?.progress).toBe(0);
  });
});
