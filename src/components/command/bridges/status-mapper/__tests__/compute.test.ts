/**
 * @license GPL-3.0-only
 *
 * Unit tests for buildComputePatch: the compute-profile fan-out that maps a
 * cmd_droneStatus heartbeat's compute fields into the compute store's cluster
 * slice. Covers the profile gate, the no-compute-fields no-op, full + sparse
 * mapping (merge over current), slave coercion, and malformed-entry dropping.
 */

import { describe, it, expect } from "vitest";
import { buildComputePatch } from "../compute";
import { EMPTY_COMPUTE_CLUSTER } from "@/stores/compute-store";

const current = { cluster: { ...EMPTY_COMPUTE_CLUSTER } };

describe("buildComputePatch — profile gate", () => {
  it("returns null for a non-compute profile", () => {
    expect(buildComputePatch({ profile: "drone", computeRole: "master" }, current, 1)).toBeNull();
    expect(buildComputePatch({ profile: "ground-station" }, current, 1)).toBeNull();
    expect(buildComputePatch({}, current, 1)).toBeNull();
  });

  it("returns null for a compute profile with no compute fields", () => {
    expect(buildComputePatch({ profile: "workstation" }, current, 1)).toBeNull();
  });
});

describe("buildComputePatch — full mapping", () => {
  it("maps role, queue, active, idle, aggregate, and master id", () => {
    const patch = buildComputePatch(
      {
        profile: "workstation",
        computeRole: "master",
        computeClusterMasterId: "node-a",
        computeQueueDepth: 3,
        computeActiveJobs: 1,
        computeActiveSessions: 4,
        computeWorkersIdle: 2,
        computeClusterAggregateWorkersIdle: 6,
      },
      current,
      1234,
    );
    expect(patch).not.toBeNull();
    expect(patch!.cluster).toMatchObject({
      role: "master",
      masterId: "node-a",
      queueDepth: 3,
      activeJobs: 1,
      activeSessions: 4,
      workersIdle: 2,
      aggregateWorkersIdle: 6,
      slaves: [],
      updatedAt: 1234,
    });
  });

  it("coerces the slaves array and drops malformed entries", () => {
    const patch = buildComputePatch(
      {
        profile: "workstation",
        computeRole: "master",
        computeClusterSlaves: [
          { nodeId: "node-b", accelerators: ["cuda:0"], workersIdle: 4, queueDepth: 0 },
          { accelerators: ["mps"], workersIdle: 1, queueDepth: 0 }, // no nodeId -> dropped
          "not-an-object", // dropped
          { nodeId: "node-c" }, // missing counters -> null (not reported), accelerators []
        ],
      },
      current,
      5,
    );
    expect(patch!.cluster.slaves).toEqual([
      { nodeId: "node-b", accelerators: ["cuda:0"], workersIdle: 4, queueDepth: 0 },
      { nodeId: "node-c", accelerators: [], workersIdle: null, queueDepth: null },
    ]);
  });
});

describe("buildComputePatch — sparse heartbeat merges over current", () => {
  it("preserves prior values for fields absent in this heartbeat", () => {
    const prior = {
      cluster: {
        role: "master",
        masterId: "node-a",
        queueDepth: 5,
        activeJobs: 2,
        activeSessions: 3,
        workersIdle: 0,
        aggregateWorkersIdle: 0,
        slaves: [
          { nodeId: "node-b", accelerators: ["cuda:0"], workersIdle: 4, queueDepth: 0 },
        ],
        updatedAt: 100,
      },
    };
    // Only queue depth changes; everything else (incl. the slave list + the
    // serving-sessions count) is kept.
    const patch = buildComputePatch(
      { profile: "workstation", computeQueueDepth: 7 },
      prior,
      200,
    );
    expect(patch!.cluster).toMatchObject({
      role: "master",
      masterId: "node-a",
      queueDepth: 7,
      activeJobs: 2,
      activeSessions: 3,
      slaves: prior.cluster.slaves,
      updatedAt: 200,
    });
  });

  it("ignores non-finite / wrong-typed numerics (treated as absent)", () => {
    const patch = buildComputePatch(
      {
        profile: "workstation",
        computeRole: "slave",
        computeQueueDepth: "nan",
        computeWorkersIdle: Number.NaN,
      },
      current,
      9,
    );
    // role applied; the bad numerics fall back to current (null).
    expect(patch!.cluster.role).toBe("slave");
    expect(patch!.cluster.queueDepth).toBeNull();
    expect(patch!.cluster.workersIdle).toBeNull();
  });
});
