/**
 * @module lib/atlas/world-generation
 * @description Folds the world-model descriptor stream into the newest
 * generation's artifact set, and classifies what that set honestly says.
 *
 * A generation crosses as up to four independent descriptor events (splat,
 * point cloud, mesh, occupancy) published back-to-back for one completed
 * reconstruct job, so the set is assembled incrementally and a slot the
 * generation did not produce stays null — never a placeholder, so an absent mesh
 * cannot be mistaken for an empty one.
 *
 * # "No world model" is not "an empty world"
 *
 * The producer publishes NOTHING for a generation with nothing readable: it
 * derives the descriptor set, and if the set is empty it returns before touching
 * the stream. So silence means "no world model was produced", and it must not
 * render as an empty world — an operator who reads a fabricated empty world as
 * a surveyed empty volume has been told the opposite of the truth. The two
 * states are therefore separate values of {@link WorldModelPresence}, along with
 * a third for the case where a generation arrived but stated no readable count
 * at all.
 *
 * # Ordering is per session, not global
 *
 * `generation` is the live reconstruct CYCLE index for a capture session (the
 * final bag lands at the cycle count), so it restarts on a new session and
 * carries no cross-session order. Within one session a lower generation is
 * superseded and dropped; a descriptor from a DIFFERENT session is a different
 * world and replaces the current one outright, because the wire offers no way
 * to rank two sessions and the newest arrival is the only defensible answer.
 *
 * @license GPL-3.0-only
 */

import type {
  MeshArtifact,
  OccupancyArtifact,
  PointCloudArtifact,
  SplatArtifact,
  WorldArtifact,
} from "./world-descriptors";
import { occupancyVoxelCount } from "./world-descriptors";

/** One reconstruction generation's immutable artifact set, as far as it has
 * been received. Each slot is null when the generation produced no artifact of
 * that kind (or its descriptor has not arrived yet). */
export interface WorldModelGeneration {
  /** The capture session this generation reconstructs. */
  sessionId: string;
  /** Monotonic generation within {@link sessionId}. */
  generation: number;
  splat: SplatArtifact | null;
  pointcloud: PointCloudArtifact | null;
  mesh: MeshArtifact | null;
  occupancy: OccupancyArtifact | null;
  /** Epoch ms the newest descriptor in this set was folded in. */
  receivedAt: number;
}

/** What the newest generation honestly says about the world. */
export type WorldModelPresence =
  /** No generation has ever been received. The producer publishes nothing for a
   * generation with nothing readable, so this is "no world model" — NOT an
   * empty world. */
  | "absent"
  /** A generation arrived and every artifact it carries states a measured zero:
   * a real, surveyed, empty result. */
  | "empty"
  /** A generation arrived but no artifact stated a readable count, so its
   * content is unknown rather than empty. */
  | "unknown"
  /** A generation arrived carrying measured content. */
  | "present";

/** How a descriptor was folded in, so a consumer can count what it dropped. */
export type WorldArtifactApplication =
  /** Started a new generation (first ever, a newer generation, or a new
   * session). */
  | "opened"
  /** Filled a slot on the current generation. */
  | "folded"
  /** Named an older generation of the same session and was dropped. */
  | "superseded";

export interface WorldArtifactApplyResult {
  generation: WorldModelGeneration;
  application: WorldArtifactApplication;
}

function withSlot(
  base: WorldModelGeneration,
  artifact: WorldArtifact,
  nowMs: number,
): WorldModelGeneration {
  const next: WorldModelGeneration = { ...base, receivedAt: nowMs };
  switch (artifact.kind) {
    case "splat":
      next.splat = artifact;
      break;
    case "pointcloud":
      next.pointcloud = artifact;
      break;
    case "mesh":
      next.mesh = artifact;
      break;
    case "occupancy":
      next.occupancy = artifact;
      break;
  }
  return next;
}

/**
 * Fold one decoded descriptor into `current`, returning the resulting
 * generation and how the descriptor was treated.
 *
 * Pure: the caller owns the state. A superseded descriptor returns `current`
 * unchanged (same object identity), so a store can skip the notification.
 */
export function applyWorldArtifact(
  current: WorldModelGeneration | null,
  artifact: WorldArtifact,
  nowMs: number,
): WorldArtifactApplyResult {
  const opened: WorldModelGeneration = {
    sessionId: artifact.sessionId,
    generation: artifact.generation,
    splat: null,
    pointcloud: null,
    mesh: null,
    occupancy: null,
    receivedAt: nowMs,
  };
  if (current === null) {
    return {
      generation: withSlot(opened, artifact, nowMs),
      application: "opened",
    };
  }
  // A different session is a different world, and the wire carries no order
  // between two sessions, so the newest arrival wins outright.
  if (artifact.sessionId !== current.sessionId) {
    return {
      generation: withSlot(opened, artifact, nowMs),
      application: "opened",
    };
  }
  if (artifact.generation > current.generation) {
    return {
      generation: withSlot(opened, artifact, nowMs),
      application: "opened",
    };
  }
  if (artifact.generation < current.generation) {
    return { generation: current, application: "superseded" };
  }
  return {
    generation: withSlot(current, artifact, nowMs),
    application: "folded",
  };
}

/**
 * The measured content count for each artifact present in the generation:
 * `number` when the descriptor stated one (0 included — a stated empty), and
 * `null` when it did not.
 */
export function artifactContentCounts(
  generation: WorldModelGeneration,
): (number | null)[] {
  const counts: (number | null)[] = [];
  if (generation.splat) counts.push(generation.splat.gaussianCount);
  if (generation.pointcloud) counts.push(generation.pointcloud.pointCount);
  if (generation.mesh) counts.push(generation.mesh.vertexCount);
  if (generation.occupancy) {
    counts.push(occupancyVoxelCount(generation.occupancy));
  }
  return counts;
}

/**
 * Classify what the newest generation says. `null` (nothing ever received) is
 * `"absent"`, which is the state that must never render as an empty world.
 */
export function worldModelPresence(
  generation: WorldModelGeneration | null,
): WorldModelPresence {
  if (generation === null) return "absent";
  const counts = artifactContentCounts(generation);
  if (counts.some((c) => c !== null && c > 0)) return "present";
  if (counts.some((c) => c === 0)) return "empty";
  return "unknown";
}
