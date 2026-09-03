/**
 * @license GPL-3.0-only
 *
 * The four world-model artifact descriptors, decoded from frames the agent's own
 * producer emitted.
 *
 * The load-bearing assertions here are the honesty ones: an ABSENT count decodes
 * to null and never to zero, a STATED zero stays zero, and a degenerate all-zero
 * bounds box reads as no measured extent rather than as a zero-size world. An
 * operator plans clearance against these numbers, so a fabricated zero is worse
 * than an admitted unknown.
 */

import { describe, it, expect } from "vitest";

import {
  boundsExtent,
  decodeWorldDescriptor,
  occupancyBufferBytes,
  occupancyVoxelCount,
  type OccupancyArtifact,
  type PointCloudArtifact,
  type SplatArtifact,
} from "../world-descriptors";
import {
  PLUGIN_ATLAS_MESH_TOPIC,
  PLUGIN_ATLAS_OCCUPANCY_TOPIC,
  PLUGIN_ATLAS_POINTCLOUD_TOPIC,
  PLUGIN_ATLAS_POSE_TOPIC,
  PLUGIN_ATLAS_SPLAT_TOPIC,
} from "../world-contract";
import {
  encodeTestMap,
  GOLDEN_CLOUD_HEX,
  GOLDEN_MESH_HEX,
  GOLDEN_OCCUPANCY_ESDF_HEX,
  GOLDEN_OCCUPANCY_PLAIN_HEX,
  GOLDEN_SPLAT_HEX,
  hexBytes,
} from "./golden-atlas-frames";

describe("splat descriptor", () => {
  it("decodes the producer frame with every stated fact", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_SPLAT_TOPIC,
      hexBytes(GOLDEN_SPLAT_HEX),
    ) as SplatArtifact;
    expect(a.kind).toBe("splat");
    expect(a.sessionId).toBe("atlas-drone-1-1000");
    expect(a.generation).toBe(7);
    expect(a.gaussianCount).toBe(1_250_000);
    expect(a.step).toBe(30_000);
    expect(a.lodLevels).toBe(4);
    expect(a.url).toBe("http://192.168.1.50:8092/artifacts/job-1/splat.ply");
    expect(a.handle).toBeNull();
    expect(a.manifestUrl).toBe(
      "http://192.168.1.50:8092/artifacts/job-1/manifest.json",
    );
    expect(a.unstated).toEqual([]);
  });

  it("reads an ABSENT gaussian count as unknown, never as zero", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_SPLAT_TOPIC,
      encodeTestMap({
        session_id: "s-1",
        generation: 3,
        step: 100,
        url: "http://node/splat.ply",
      }),
    ) as SplatArtifact;
    expect(a.gaussianCount).toBeNull();
    expect(a.gaussianCount).not.toBe(0);
    expect([...a.unstated]).toEqual(["gaussian_count"]);
  });

  it("reads a STATED zero as a measured zero", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_SPLAT_TOPIC,
      encodeTestMap({ session_id: "s-1", generation: 3, gaussian_count: 0, step: 0 }),
    ) as SplatArtifact;
    expect(a.gaussianCount).toBe(0);
    expect(a.unstated).toEqual([]);
  });

  it("falls back to the contract's own defaults for the defaulted fields", () => {
    // session_id / generation / lod_levels carry `#[serde(default)]` upstream, so
    // their absence has a contract-defined reading rather than being unknown.
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_SPLAT_TOPIC,
      encodeTestMap({ gaussian_count: 5, step: 1 }),
    ) as SplatArtifact;
    expect(a.sessionId).toBe("");
    expect(a.generation).toBe(0);
    expect(a.lodLevels).toBe(0);
    expect(a.manifestUrl).toBeNull();
  });
});

describe("point-cloud descriptor", () => {
  it("decodes the producer frame's count and bounds", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_POINTCLOUD_TOPIC,
      hexBytes(GOLDEN_CLOUD_HEX),
    ) as PointCloudArtifact;
    expect(a.pointCount).toBe(480_000);
    expect(a.bounds).toEqual([-12.5, -8, 0, 31.25, 19.5, 42.75]);
    expect(a.shmName).toBeNull();
    expect(a.url).toBe("http://192.168.1.50:8092/artifacts/job-1/cloud.ply");
    expect(boundsExtent(a.bounds)).toEqual([43.75, 27.5, 42.75]);
  });

  it("reads a degenerate all-zero bounds as NO measured extent", () => {
    // The producer's `bounds` is a non-optional [f64; 6] that falls back to
    // [0.0; 6] when it could not parse the artifact, so an exactly-empty box is
    // the unmeasured sentinel — not a zero-size world an operator could survey.
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_POINTCLOUD_TOPIC,
      encodeTestMap({
        session_id: "s-1",
        generation: 1,
        point_count: 0,
        bounds: [0, 0, 0, 0, 0, 0],
      }),
    ) as PointCloudArtifact;
    expect(a.bounds).toEqual([0, 0, 0, 0, 0, 0]);
    expect(boundsExtent(a.bounds)).toBeNull();
  });

  it("reads a wrong-arity bounds as no box at all", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_POINTCLOUD_TOPIC,
      encodeTestMap({ point_count: 10, bounds: [0, 1, 2] }),
    ) as PointCloudArtifact;
    expect(a.bounds).toBeNull();
    expect([...a.unstated]).toEqual(["bounds"]);
  });
});

describe("mesh descriptor", () => {
  it("decodes the producer frame", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_MESH_TOPIC,
      hexBytes(GOLDEN_MESH_HEX),
    );
    expect(a).toMatchObject({
      kind: "mesh",
      sessionId: "atlas-drone-1-1000",
      generation: 7,
      vertexCount: 90_000,
      faceCount: 178_000,
      handle: null,
    });
  });
});

describe("occupancy descriptor", () => {
  it("decodes an ESDF grid with its truncation radius", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_OCCUPANCY_TOPIC,
      hexBytes(GOLDEN_OCCUPANCY_ESDF_HEX),
    ) as OccupancyArtifact;
    expect(a.field).toBe("esdf");
    expect(a.origin).toEqual([-16.5, -12, -4]);
    expect(a.resolutionM).toBeCloseTo(0.2, 6);
    expect(a.dims).toEqual([240, 180, 60]);
    expect(a.truncationM).toBe(4);
    expect(occupancyVoxelCount(a)).toBe(240 * 180 * 60);
    // f32 metres per voxel for an ESDF, per the producer's documented layout.
    expect(occupancyBufferBytes(a)).toBe(240 * 180 * 60 * 4);
  });

  it("treats truncation as meaningless on a plain occupancy buffer", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_OCCUPANCY_TOPIC,
      hexBytes(GOLDEN_OCCUPANCY_PLAIN_HEX),
    ) as OccupancyArtifact;
    expect(a.field).toBe("occupancy");
    // The wire carries 0.0; surfacing it as a clearance radius would be a
    // fabricated distance, so it decodes to unknown.
    expect(a.truncationM).toBeNull();
    expect(a.url).toBeNull();
    // u8 probability per voxel.
    expect(occupancyBufferBytes(a)).toBe(240 * 180 * 60);
  });

  it("defaults an absent field to plain occupancy, never to a distance field", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_OCCUPANCY_TOPIC,
      encodeTestMap({
        origin: [0, 0, 0],
        resolution_m: 0.2,
        dims: [2, 2, 2],
      }),
    ) as OccupancyArtifact;
    expect(a.field).toBe("occupancy");
    expect(a.truncationM).toBeNull();
  });

  it("reads an unstated grid geometry as unknown and names it", () => {
    const a = decodeWorldDescriptor(
      PLUGIN_ATLAS_OCCUPANCY_TOPIC,
      encodeTestMap({ session_id: "s-1", generation: 2, field: "esdf" }),
    ) as OccupancyArtifact;
    expect(a.dims).toBeNull();
    expect(a.resolutionM).toBeNull();
    expect(a.origin).toBeNull();
    expect(occupancyVoxelCount(a)).toBeNull();
    expect(occupancyBufferBytes(a)).toBeNull();
    expect([...a.unstated]).toEqual(["origin", "resolution_m", "dims"]);
  });
});

describe("decodeWorldDescriptor refusals", () => {
  it("returns null for the live pose lane and any non-artifact topic", () => {
    expect(
      decodeWorldDescriptor(PLUGIN_ATLAS_POSE_TOPIC, hexBytes(GOLDEN_SPLAT_HEX)),
    ).toBeNull();
    expect(
      decodeWorldDescriptor("atlas.keyframe", hexBytes(GOLDEN_SPLAT_HEX)),
    ).toBeNull();
  });

  it("returns null for a payload that is not a msgpack map", () => {
    expect(
      decodeWorldDescriptor(PLUGIN_ATLAS_SPLAT_TOPIC, hexBytes("9101")),
    ).toBeNull();
    expect(
      decodeWorldDescriptor(PLUGIN_ATLAS_SPLAT_TOPIC, hexBytes("81a16b")),
    ).toBeNull();
  });
});
