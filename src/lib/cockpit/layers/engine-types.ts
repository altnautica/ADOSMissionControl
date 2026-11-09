/**
 * @module cockpit/layers/engine-types
 * @description The options, flight context, statistics and scratch shapes of
 * the layer stack's draw loop ({@link LayerEngine}).
 *
 * @license GPL-3.0-only
 */

import type { LayerLevel } from "@/lib/hud/ar-layout";
import type { AvoidState, MissionState } from "@/lib/hud/cockpit-frames";
import type { DepthRange, DepthStyle } from "@/stores/cockpit-layers-store";

/** The status chips the engine can draw; the shell passes localised text. */
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
export const DEFAULT_CHIP_TEXT: LayerChipText = {
  arUnavailable: "AR unavailable",
  arApprox: "AR ≈",
  depthUnavailable: "Depth unavailable",
  depthUnscaled: "Depth unscaled",
  surfacesUnavailable: "Surfaces unavailable",
  obstaclesUnavailable: "Obstacles unavailable",
  targetsUnavailable: "Targets unavailable",
};

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
