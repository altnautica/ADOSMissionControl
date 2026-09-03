/**
 * @license GPL-3.0-only
 *
 * The generation reducer and the presence classifier.
 *
 * The classifier is the whole reason this module exists: the producer publishes
 * NOTHING for a generation with nothing readable, so silence has to read as "no
 * world model" and must be a different value from "a generation arrived and
 * measured zero content". A third value covers "a generation arrived but stated
 * no readable count", which is also not empty.
 */

import { describe, it, expect } from "vitest";

import {
  applyWorldArtifact,
  artifactContentCounts,
  worldModelPresence,
  type WorldModelGeneration,
} from "../world-generation";
import type {
  MeshArtifact,
  OccupancyArtifact,
  PointCloudArtifact,
  SplatArtifact,
} from "../world-descriptors";

function splat(
  generation: number,
  gaussianCount: number | null,
  sessionId = "s-1",
): SplatArtifact {
  return {
    kind: "splat",
    sessionId,
    generation,
    gaussianCount,
    step: 100,
    url: "http://node/splat.ply",
    handle: null,
    manifestUrl: null,
    lodLevels: 0,
    unstated: gaussianCount === null ? ["gaussian_count"] : [],
  };
}

function cloud(
  generation: number,
  pointCount: number | null,
  sessionId = "s-1",
): PointCloudArtifact {
  return {
    kind: "pointcloud",
    sessionId,
    generation,
    pointCount,
    bounds: [0, 0, 0, 1, 1, 1],
    shmName: null,
    slot: null,
    seq: null,
    url: null,
    unstated: [],
  };
}

function mesh(generation: number, vertexCount: number | null): MeshArtifact {
  return {
    kind: "mesh",
    sessionId: "s-1",
    generation,
    vertexCount,
    faceCount: null,
    url: null,
    handle: null,
    unstated: [],
  };
}

function occupancy(
  generation: number,
  dims: readonly number[] | null,
): OccupancyArtifact {
  return {
    kind: "occupancy",
    sessionId: "s-1",
    generation,
    origin: [0, 0, 0],
    resolutionM: 0.2,
    dims,
    field: "esdf",
    truncationM: 4,
    shmName: null,
    slot: null,
    seq: null,
    url: null,
    unstated: [],
  };
}

describe("applyWorldArtifact", () => {
  it("opens a generation from the first descriptor", () => {
    const { generation, application } = applyWorldArtifact(
      null,
      splat(4, 1000),
      50,
    );
    expect(application).toBe("opened");
    expect(generation.generation).toBe(4);
    expect(generation.sessionId).toBe("s-1");
    expect(generation.splat?.gaussianCount).toBe(1000);
    // A slot the generation has not produced stays null — never a placeholder.
    expect(generation.pointcloud).toBeNull();
    expect(generation.mesh).toBeNull();
    expect(generation.occupancy).toBeNull();
    expect(generation.receivedAt).toBe(50);
  });

  it("folds the remaining descriptors of the same generation into one set", () => {
    let g = applyWorldArtifact(null, splat(4, 1000), 1).generation;
    const folded = applyWorldArtifact(g, cloud(4, 2000), 2);
    expect(folded.application).toBe("folded");
    g = folded.generation;
    expect(g.splat?.gaussianCount).toBe(1000);
    expect(g.pointcloud?.pointCount).toBe(2000);
    expect(g.generation).toBe(4);
    expect(g.receivedAt).toBe(2);
  });

  it("replaces the set when a newer generation of the same session arrives", () => {
    const g4 = applyWorldArtifact(
      applyWorldArtifact(null, splat(4, 1000), 1).generation,
      cloud(4, 2000),
      2,
    ).generation;
    const next = applyWorldArtifact(g4, splat(5, 3000), 3);
    expect(next.application).toBe("opened");
    expect(next.generation.generation).toBe(5);
    expect(next.generation.splat?.gaussianCount).toBe(3000);
    // Generation 5's set is 5's own — 4's cloud is not carried forward, because
    // an artifact set describes exactly one generation.
    expect(next.generation.pointcloud).toBeNull();
  });

  it("drops an older generation of the same session without touching state", () => {
    const g5 = applyWorldArtifact(null, splat(5, 3000), 1).generation;
    const stale = applyWorldArtifact(g5, splat(4, 1000), 2);
    expect(stale.application).toBe("superseded");
    // Same object identity, so a store can skip its notification.
    expect(stale.generation).toBe(g5);
  });

  it("replaces outright for a different session, whose counter restarts", () => {
    // `generation` is the reconstruct cycle index WITHIN a capture session, so a
    // new session's generation 0 is not older than the last session's 5.
    const g5 = applyWorldArtifact(null, splat(5, 3000, "s-1"), 1).generation;
    const other = applyWorldArtifact(g5, splat(0, 7, "s-2"), 2);
    expect(other.application).toBe("opened");
    expect(other.generation.sessionId).toBe("s-2");
    expect(other.generation.generation).toBe(0);
  });
});

describe("worldModelPresence", () => {
  it("reads nothing-ever-received as absent, which is NOT empty", () => {
    expect(worldModelPresence(null)).toBe("absent");
    expect(worldModelPresence(null)).not.toBe("empty");
  });

  it("reads a measured-zero generation as empty, which is NOT absent", () => {
    const g = applyWorldArtifact(null, splat(1, 0), 1).generation;
    expect(worldModelPresence(g)).toBe("empty");
    expect(worldModelPresence(g)).not.toBe("absent");
  });

  it("reads a generation with no stated count as unknown, not empty", () => {
    const g = applyWorldArtifact(null, splat(1, null), 1).generation;
    expect(worldModelPresence(g)).toBe("unknown");
    expect(worldModelPresence(g)).not.toBe("empty");
  });

  it("reads any measured content as present, even beside a zero sibling", () => {
    const g = applyWorldArtifact(
      applyWorldArtifact(null, splat(1, 0), 1).generation,
      cloud(1, 500),
      2,
    ).generation;
    expect(worldModelPresence(g)).toBe("present");
  });

  it("counts an occupancy grid by its voxels and a mesh by its vertices", () => {
    const g: WorldModelGeneration = {
      sessionId: "s-1",
      generation: 1,
      splat: null,
      pointcloud: null,
      mesh: mesh(1, 90_000),
      occupancy: occupancy(1, [2, 3, 4]),
      receivedAt: 1,
    };
    expect(artifactContentCounts(g)).toEqual([90_000, 24]);
    expect(worldModelPresence(g)).toBe("present");
  });

  it("reads an occupancy grid with unstated dims as unknown, not an empty grid", () => {
    const g = applyWorldArtifact(null, occupancy(1, null), 1).generation;
    expect(artifactContentCounts(g)).toEqual([null]);
    expect(worldModelPresence(g)).toBe("unknown");
  });
});
