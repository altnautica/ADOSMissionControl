/**
 * @module atlas/viewer-types
 * @description The Atlas World Model viewer registry. The operator switches
 * between viewers on the same world (a `viewer` parameter). Rerun is the
 * first-class default world viewer + live-stream surface; the splat viewer
 * plays photoreal gaussian splats
 * (the one thing Rerun does not render natively); the cloud viewer renders a dense point
 * cloud (`.ply`) on the repo's own three.js. The LOD viewer is the cloud viewer
 * that survives very large clouds — it decimates a multi-million-point `.ply` to
 * a point budget (a single-level voxel-grid pass) so the retained buffer never
 * exhausts memory, the gap the plain cloud viewer has. The historical Potree
 * blocker (its loader pins an older three.js, so the package cannot be added) is
 * sidestepped by loading the PLY with the repo's three 0.183 directly; true
 * out-of-core octree streaming for clouds that don't fit in memory at all stays a
 * follow-on.
 * @license GPL-3.0-only
 */

/** A selectable World Model viewer. */
export type AtlasViewer = "rerun" | "splat" | "cloud" | "lod";

export interface AtlasViewerSpec {
  id: AtlasViewer;
  /** Short switcher label. */
  label: string;
}

/** The viewers offered in the switcher, in order; the first is the default. */
export const ATLAS_VIEWERS: readonly AtlasViewerSpec[] = [
  { id: "rerun", label: "World" },
  { id: "splat", label: "Splat" },
  { id: "cloud", label: "Cloud" },
  { id: "lod", label: "LOD" },
];

export const DEFAULT_ATLAS_VIEWER: AtlasViewer = ATLAS_VIEWERS[0].id;

/**
 * The viewer a world prefers, read from an Atlas job's opaque
 * `metadata.viewerHint`. Returns null when the metadata is absent or carries
 * no recognized hint, so the caller falls back to {@link DEFAULT_ATLAS_VIEWER}.
 */
export function viewerHintOf(metadata: unknown): AtlasViewer | null {
  if (!metadata || typeof metadata !== "object") return null;
  const hint = (metadata as Record<string, unknown>).viewerHint;
  if (typeof hint === "string" && ATLAS_VIEWERS.some((v) => v.id === hint)) {
    return hint as AtlasViewer;
  }
  return null;
}

/**
 * The concrete reconstruction backend a cloud (`cmd_atlasJobs`) world carries,
 * read from the job's opaque `metadata.backend` — the same honesty field the
 * local compute output stamps on `meta.backend`. Returns null when absent, so
 * the cloud path shows no backend badge until the compute→Convex producer
 * forwards it. Sibling of {@link viewerHintOf}.
 */
export function backendOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const b = (metadata as Record<string, unknown>).backend;
  return typeof b === "string" && b.length > 0 ? b : null;
}

/**
 * The best viewer for a compute-node output's artifact kind (`splat`, `cloud` /
 * `ply` / `pointcloud`, …). Used when sourcing a world model local-first from the
 * compute node, where the artifact's kind is the hint (there is no Convex
 * `metadata.viewerHint`). Falls back to the default Rerun world viewer.
 */
export function viewerForKind(kind: string): AtlasViewer {
  switch (kind) {
    case "splat":
      return "splat";
    case "cloud":
    case "ply":
    case "pointcloud":
      return "cloud";
    default:
      return DEFAULT_ATLAS_VIEWER;
  }
}

/** Point-cloud artifact kinds (consumed by the Cloud / LOD viewers). */
const CLOUD_KINDS = ["cloud", "pointcloud", "ply"];

/**
 * The output artifact a given viewer should load, matched by the artifact's
 * `kind`. A reconstruct job can emit several outputs (a `splat` `.ply`, a
 * point-cloud `.ply`, and a `rerun` `.rrd`), so each viewer must pick ITS kind
 * — the splat viewer needs the gaussian-splat `.ply`, not a plain point cloud
 * (which lacks scale/rotation/opacity and renders as a black nothing). Returns
 * undefined when no matching kind exists, so the caller can fall back.
 */
export function pickArtifactForViewer<T extends { kind: string }>(
  outputs: readonly T[],
  viewer: AtlasViewer,
): T | undefined {
  if (viewer === "rerun") return outputs.find((o) => o.kind === "rerun");
  if (viewer === "splat") return outputs.find((o) => o.kind === "splat");
  // cloud / lod → a dense point-cloud `.ply`
  return outputs.find((o) => CLOUD_KINDS.includes(o.kind));
}
