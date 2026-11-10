/**
 * @module cockpit/layers/engine-types
 * @description The options, flight context, statistics and scratch shapes of
 * the layer stack's draw loop ({@link LayerEngine}).
 *
 * @license GPL-3.0-only
 */

import layersSpec from "@/lib/cockpit-spec/layers.json";
import { specText } from "@/lib/hud/spec-text";
import type { LayerLevel } from "@/lib/hud/ar-layout";
import type { AvoidState, MissionState } from "@/lib/hud/cockpit-frames";
import type { DepthRange, DepthStyle } from "@/stores/cockpit-layers-store";

/** The status chips the engine can draw, in the shared spec text. */
export type LayerChipText = Record<
  | "arUnavailable"
  | "arApprox"
  | "depthUnavailable"
  | "depthUnscaled"
  | "surfacesUnavailable"
  | "obstaclesUnavailable"
  | "targetsUnavailable",
  string
>;
/** The chip texts from the spec (`layer.unavailable` with the layer's label,
 *  `layer.ar_approx`, `layer.depth_unscaled`). */
export function specLayerChipText(): LayerChipText {
  const label = (id: string) => (layersSpec.layers as { id: string; label: string }[]).find((l) => l.id === id)?.label ?? id;
  const unavailable = (layer: string) => specText("layer.unavailable", { layer });
  return {
    arUnavailable: unavailable(specText("layer.name.ar")),
    arApprox: specText("layer.ar_approx"),
    depthUnavailable: unavailable(label("depth")),
    depthUnscaled: specText("layer.depth_unscaled"),
    surfacesUnavailable: unavailable(label("surfaces")),
    obstaclesUnavailable: unavailable(label("obstacles")),
    targetsUnavailable: unavailable(label("targets")),
  };
}

/** What the loop draws, set from React only when a toggle, the level, the
 * camera or the view changes. */
export interface LayerOptions {
  droneId: string;
  cameraId: string;
  level: LayerLevel;
  layers: ReadonlySet<string>;
  depthMode: DepthStyle;
  depthRange: DepthRange;
  /** Max frames per second (kiosk/TV: 30); 0 = display rate. */
  fpsCap: number;
}

/** Live flight context the AR layout needs, read at draw time into the
 * engine's own object (never through React state). */
export interface FlightContext {
  mission: MissionState | null;
  avoid: AvoidState | null;
  showLoaded: boolean;
}

/** Draw-time statistics for the performance gate. */
export interface LayerPerf {
  draws: number;
  skipped: number;
  /** Last 512 draw durations, ms. */
  samples: Float64Array;
  cursor: number;
}

/** A decoded per-camera grid in reused buffers. */
export interface GridScratch {
  near: Uint8Array;
  measured: Uint8Array;
  hasMeasured: boolean;
}

/** Per-kind layout state: the frame the ops were laid out from, and whether a
 * rect or option change since then forces a new layout. */
export interface Laid {
  frame: unknown;
  valid: boolean;
}
