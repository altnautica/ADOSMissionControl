/**
 * @module lib/atlas/world-descriptors
 * @description The four world-model artifact descriptors the compute node
 * publishes on the `plugin.atlas.*` shared-data topics, decoded from their
 * msgpack payloads into the GCS's own shapes.
 *
 * A reconstruction is a JOB producing an immutable artifact set, not a stream:
 * generation N's splat, cloud, mesh and occupancy all describe the same capture
 * state, so a consumer diffs generations and a viewer can fetch coarse chunks of
 * N while N-1 is still on screen.
 *
 * # Absent is not zero
 *
 * The producer's rule is that a descriptor "either states a measured fact or
 * omits the field", and the counts (`gaussian_count`, `point_count`,
 * `vertex_count`, `face_count`, `step`) plus the geometry
 * (`bounds`, `origin`, `resolution_m`, `dims`) carry NO serde default on the
 * agent side — they are required. So an absent count is a descriptor that did
 * not state one, and it decodes to `null` (unknown), never to `0`. A present `0`
 * is a stated fact: a measured empty artifact. An operator planning clearance
 * against a fabricated zero is the failure this distinction exists to prevent,
 * and every count on these types is therefore nullable at the type level so a
 * surface cannot render one without deciding what unknown looks like.
 *
 * `session_id`, `generation`, `field`, `truncation_m` and `lod_levels` DO carry
 * `#[serde(default)]` upstream, so their absence has a contract-defined reading
 * (`""`, `0`, `occupancy`, `0`, `0`) which is mirrored here. That is the
 * contract's default, not an invention of this module — notably `field`
 * defaulting to plain occupancy is deliberate upstream, so an older producer's
 * buffer is never mis-read as a distance field in metres.
 *
 * @license GPL-3.0-only
 */

import {
  asMsgpackMap,
  decodeMsgpack,
  type MsgpackValue,
} from "./msgpack";
import {
  PLUGIN_ATLAS_MESH_TOPIC,
  PLUGIN_ATLAS_OCCUPANCY_TOPIC,
  PLUGIN_ATLAS_POINTCLOUD_TOPIC,
  PLUGIN_ATLAS_SPLAT_TOPIC,
} from "./world-contract";

/** What an occupancy buffer's voxels hold. */
export type OccupancyFieldKind = "occupancy" | "esdf";

/** The artifact kinds a generation can carry, one per shared-data topic. */
export type WorldArtifactKind = "splat" | "pointcloud" | "mesh" | "occupancy";

interface ArtifactBase {
  kind: WorldArtifactKind;
  /** The capture session this artifact was reconstructed from (`""` when the
   * descriptor omitted it — the upstream serde default). */
  sessionId: string;
  /** Monotonic artifact generation (`0` when omitted — the upstream default). */
  generation: number;
  /** Required contract fields this descriptor did not state, so a surface can
   * badge a partial descriptor instead of showing a confident unknown. */
  unstated: readonly string[];
}

export interface SplatArtifact extends ArtifactBase {
  kind: "splat";
  /** Measured gaussian count, or null when the descriptor stated none. */
  gaussianCount: number | null;
  /** Training step this descriptor reflects, or null when unstated. */
  step: number | null;
  url: string | null;
  handle: string | null;
  /** LOD chunk manifest for progressive streaming, when the producer wrote one. */
  manifestUrl: string | null;
  /** LOD levels behind the manifest (0 when there is no manifest). */
  lodLevels: number;
}

export interface PointCloudArtifact extends ArtifactBase {
  kind: "pointcloud";
  pointCount: number | null;
  /** Axis-aligned bounds `[minX, minY, minZ, maxX, maxY, maxZ]`, or null when
   * the descriptor stated none. */
  bounds: readonly number[] | null;
  shmName: string | null;
  slot: number | null;
  seq: number | null;
  url: string | null;
}

export interface MeshArtifact extends ArtifactBase {
  kind: "mesh";
  vertexCount: number | null;
  faceCount: number | null;
  url: string | null;
  handle: string | null;
}

export interface OccupancyArtifact extends ArtifactBase {
  kind: "occupancy";
  /** World-frame origin of voxel `(0,0,0)`, or null when unstated. */
  origin: readonly number[] | null;
  /** Voxel edge length in metres, or null when unstated. */
  resolutionM: number | null;
  /** Grid dimensions in voxels `[nx, ny, nz]`, or null when unstated. */
  dims: readonly number[] | null;
  field: OccupancyFieldKind;
  /** Truncation radius in metres for an ESDF buffer. Null for a plain occupancy
   * buffer, where the upstream field is documented as meaningless — rendering
   * its zero as a clearance figure would be a fabricated distance. */
  truncationM: number | null;
  shmName: string | null;
  slot: number | null;
  seq: number | null;
  /** Where the buffer can be fetched. Row-major `nx*ny*nz`, little-endian: `u8`
   * occupancy probability, or `f32` metres for an ESDF. */
  url: string | null;
}

export type WorldArtifact =
  | SplatArtifact
  | PointCloudArtifact
  | MeshArtifact
  | OccupancyArtifact;

/** The msgpack map a descriptor payload decodes to. */
type Fields = { [key: string]: MsgpackValue };

/**
 * A count or index the descriptor STATED, or null when it did not.
 *
 * Null covers an absent key, an explicit nil, a non-integer, and a negative —
 * every case where the producer did not hand over a usable measured count. A
 * 64-bit value past `Number.MAX_SAFE_INTEGER` arrives as a `bigint` and is
 * narrowed with `Number()`; that rounds above 2^53, which for a gaussian or
 * point count is nine quadrillion primitives and therefore not a reading any
 * surface can act on differently.
 */
function statedCount(fields: Fields, key: string): number | null {
  const raw = fields[key];
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return null;
  return raw;
}

/** A finite number the descriptor stated, or null. */
function statedNumber(fields: Fields, key: string): number | null {
  const raw = fields[key];
  if (typeof raw === "bigint") return Number(raw);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** A non-empty string the descriptor stated, or null (an `Option::None` crosses
 * as the key present carrying nil, so both readings land on null). */
function statedText(fields: Fields, key: string): string | null {
  const raw = fields[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** A fixed-length numeric vector the descriptor stated, or null when absent or
 * the wrong arity — a short bounds array is not a partial box, it is not a box. */
function statedVector(
  fields: Fields,
  key: string,
  arity: number,
): readonly number[] | null {
  const raw = fields[key];
  if (!Array.isArray(raw) || raw.length !== arity) return null;
  const out: number[] = new Array(arity);
  for (let i = 0; i < arity; i++) {
    const v = raw[i];
    if (typeof v === "bigint") {
      out[i] = Number(v);
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[i] = v;
  }
  return out;
}

/** The names in `required` whose value came back null, in declaration order. */
function unstatedOf(
  required: readonly [name: string, value: unknown][],
): readonly string[] {
  return required.filter(([, value]) => value === null).map(([name]) => name);
}

function decodeSplat(fields: Fields): SplatArtifact {
  const gaussianCount = statedCount(fields, "gaussian_count");
  const step = statedCount(fields, "step");
  return {
    kind: "splat",
    sessionId: statedText(fields, "session_id") ?? "",
    generation: statedCount(fields, "generation") ?? 0,
    gaussianCount,
    step,
    url: statedText(fields, "url"),
    handle: statedText(fields, "handle"),
    manifestUrl: statedText(fields, "manifest_url"),
    lodLevels: statedCount(fields, "lod_levels") ?? 0,
    unstated: unstatedOf([
      ["gaussian_count", gaussianCount],
      ["step", step],
    ]),
  };
}

function decodePointCloud(fields: Fields): PointCloudArtifact {
  const pointCount = statedCount(fields, "point_count");
  const bounds = statedVector(fields, "bounds", 6);
  return {
    kind: "pointcloud",
    sessionId: statedText(fields, "session_id") ?? "",
    generation: statedCount(fields, "generation") ?? 0,
    pointCount,
    bounds,
    shmName: statedText(fields, "shm_name"),
    slot: statedCount(fields, "slot"),
    seq: statedCount(fields, "seq"),
    url: statedText(fields, "url"),
    unstated: unstatedOf([
      ["point_count", pointCount],
      ["bounds", bounds],
    ]),
  };
}

function decodeMesh(fields: Fields): MeshArtifact {
  const vertexCount = statedCount(fields, "vertex_count");
  const faceCount = statedCount(fields, "face_count");
  return {
    kind: "mesh",
    sessionId: statedText(fields, "session_id") ?? "",
    generation: statedCount(fields, "generation") ?? 0,
    vertexCount,
    faceCount,
    url: statedText(fields, "url"),
    handle: statedText(fields, "handle"),
    unstated: unstatedOf([
      ["vertex_count", vertexCount],
      ["face_count", faceCount],
    ]),
  };
}

function decodeOccupancy(fields: Fields): OccupancyArtifact {
  const origin = statedVector(fields, "origin", 3);
  const resolutionM = statedNumber(fields, "resolution_m");
  const dims = statedVector(fields, "dims", 3);
  // `field` carries `#[serde(default)]` upstream with plain occupancy as the
  // default, precisely so an older producer's buffer is never read as metres.
  const field: OccupancyFieldKind =
    fields.field === "esdf" ? "esdf" : "occupancy";
  return {
    kind: "occupancy",
    sessionId: statedText(fields, "session_id") ?? "",
    generation: statedCount(fields, "generation") ?? 0,
    origin,
    resolutionM: resolutionM !== null && resolutionM > 0 ? resolutionM : null,
    dims,
    field,
    truncationM: field === "esdf" ? statedNumber(fields, "truncation_m") : null,
    shmName: statedText(fields, "shm_name"),
    slot: statedCount(fields, "slot"),
    seq: statedCount(fields, "seq"),
    url: statedText(fields, "url"),
    unstated: unstatedOf([
      ["origin", origin],
      ["resolution_m", resolutionM],
      ["dims", dims],
    ]),
  };
}

/**
 * Decode a world-model descriptor payload for `topic`, or null when the topic
 * is not an artifact topic or the payload is not a msgpack map.
 *
 * A descriptor missing a required field is ACCEPTED with that field null and
 * named in `unstated`, which diverges deliberately from the agent's own strict
 * `rmp_serde` decode (which would reject the whole struct). Dropping the
 * descriptor would also drop the fetch URL and the generation, so the operator
 * would learn nothing; keeping it with an explicit unknown keeps the artifact
 * reachable and keeps the missing measurement visible as missing.
 */
export function decodeWorldDescriptor(
  topic: string,
  payload: Uint8Array,
): WorldArtifact | null {
  let fields: Fields | null;
  try {
    fields = asMsgpackMap(decodeMsgpack(payload));
  } catch {
    return null;
  }
  if (!fields) return null;
  switch (topic) {
    case PLUGIN_ATLAS_SPLAT_TOPIC:
      return decodeSplat(fields);
    case PLUGIN_ATLAS_POINTCLOUD_TOPIC:
      return decodePointCloud(fields);
    case PLUGIN_ATLAS_MESH_TOPIC:
      return decodeMesh(fields);
    case PLUGIN_ATLAS_OCCUPANCY_TOPIC:
      return decodeOccupancy(fields);
    default:
      return null;
  }
}

/** Voxels in an occupancy grid (`nx*ny*nz`), or null when `dims` was unstated. */
export function occupancyVoxelCount(
  artifact: OccupancyArtifact,
): number | null {
  const { dims } = artifact;
  return dims ? dims[0] * dims[1] * dims[2] : null;
}

/**
 * On-wire byte length of an occupancy buffer, or null when `dims` was unstated.
 * `u8` per voxel for a probability grid, `f32` for an ESDF — the layout the
 * producer documents on the descriptor's `url`.
 */
export function occupancyBufferBytes(
  artifact: OccupancyArtifact,
): number | null {
  const voxels = occupancyVoxelCount(artifact);
  return voxels === null ? null : voxels * (artifact.field === "esdf" ? 4 : 1);
}

/**
 * The reconstructed extent `[dx, dy, dz]` in metres, or null when there is no
 * measured box.
 *
 * A degenerate all-zero bounds reads as NO measured extent rather than as a
 * zero-size world. The producer's `bounds` field is a non-optional `[f64; 6]`
 * that falls back to `[0.0; 6]` when it could not parse the artifact's points,
 * so an exactly-empty box on the wire is the unmeasured sentinel — and a real
 * reconstruction cannot be zero-extent on all three axes at once. Reporting a
 * 0x0x0 world would be the fabricated figure this refuses to render.
 */
export function boundsExtent(
  bounds: readonly number[] | null,
): readonly number[] | null {
  if (!bounds || bounds.length !== 6) return null;
  const extent = [
    bounds[3] - bounds[0],
    bounds[4] - bounds[1],
    bounds[5] - bounds[2],
  ];
  return extent.every((d) => d === 0) ? null : extent;
}
