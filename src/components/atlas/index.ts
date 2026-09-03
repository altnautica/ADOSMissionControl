/**
 * @module atlas
 * @description The first-party World Model surface. Two halves that compose but
 * do not depend on each other: the VIEWER primitives, which render a
 * reconstructed 3D world from an artifact URL, and the DESCRIPTOR surface,
 * which states what a reconstruction generation actually contains. A viewer
 * shows a picture; only the descriptors say whether a planning input exists for
 * it, so both are needed and neither substitutes for the other.
 *
 *  - {@link WorldModelViewport} — the code-split viewer dispatcher (`{viewer,
 *    artifactUrl, backend}` in, the selected WASM/WebGL viewer out).
 *  - {@link ViewerSwitcher} — the World / Splat / Cloud / LOD toolbar.
 *  - viewer-types — the `AtlasViewer` union, the `ATLAS_VIEWERS` registry, and
 *    the artifact/hint resolution helpers.
 *  - {@link WorldGenerationCard} — the shared-data descriptor surface for one
 *    drone, fed by the compute node's per-device descriptor stream. Mounts
 *    under the World Model node-detail tab; it is not a route or a shell.
 *  - {@link WorldArtifactBlock} — one artifact slot of a generation, with the
 *    absent-vs-empty-vs-unknown distinctions the contract requires.
 *
 * Each leaf viewer (`viewers/*`) is a pure `{url}` component with no store
 * coupling; import them via {@link WorldModelViewport}, not directly, so the
 * dynamic-import code-splitting is preserved.
 *
 * @license GPL-3.0-only
 */

export { WorldModelViewport } from "./WorldModelViewport";
export { ViewerSwitcher } from "./ViewerSwitcher";
export { ReconstructionBadge } from "./ReconstructionBadge";
export { WorldGenerationCard } from "./WorldGenerationCard";
export {
  WorldArtifactBlock,
  CountRow,
  TextRow,
  type WorldTranslate,
} from "./WorldArtifactBlock";
export {
  ATLAS_VIEWERS,
  DEFAULT_ATLAS_VIEWER,
  viewerHintOf,
  viewerForKind,
  backendOf,
  pickArtifactForViewer,
  type AtlasViewer,
  type AtlasViewerSpec,
} from "./viewer-types";
