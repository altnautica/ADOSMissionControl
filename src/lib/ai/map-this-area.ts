/**
 * Map-this-area — turn a visible map bounding box into a ready-to-run survey.
 *
 * Given the current map viewport (a north/south/east/west bbox), produce a
 * four-corner survey polygon plus a suggested {@link SurveyConfig} that the
 * pattern store can apply directly. The grid angle is chosen to run transects
 * along the longer axis of the box (fewer turns), and the line spacing is
 * derived from the camera footprint when a camera is supplied, or from a
 * conservative altitude-based fallback otherwise.
 *
 * Fully deterministic and offline. No model call, no network.
 *
 * @module ai/map-this-area
 * @license GPL-3.0-only
 */

import {
  computeLineSpacing,
  computeTriggerDistance,
  type CameraProfile,
} from "@/lib/patterns/gsd-calculator";
import type { SurveyConfig } from "@/lib/patterns/types";
import { haversineDistance } from "@/lib/geo/distance";

/** Axis-aligned geographic bounding box, degrees. */
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Inputs for the quick-survey suggestion. */
export interface QuickSurveyOptions {
  /** Flight altitude AGL in meters. */
  altitudeM: number;
  /** Desired forward/side image overlap as a percentage, 0-100 (e.g. 70). */
  overlapPct: number;
  /** Optional camera used to derive footprint-based line spacing and triggers. */
  camera?: CameraProfile;
}

/** Approximate size of the survey the suggested config would generate. */
export interface QuickSurveyEstimate {
  /** Survey lines across the box. */
  transects: number;
  /** Mission items: two waypoints per line, plus a trigger on/off pair with a camera. */
  items: number;
  /** Flown length of the lines, overshoots and cross-over legs, metres. */
  pathLengthM: number;
}

/** A quick survey ready to hand to the pattern store. */
export interface QuickSurveyResult {
  /** Four bbox corners as [lat, lon], clockwise from the top-left. */
  polygon: [number, number][];
  /** Suggested survey configuration covering the bbox. */
  config: SurveyConfig;
  /** Size of the survey before it is generated, so an oversized box can be refused. */
  estimate: QuickSurveyEstimate;
}

/**
 * Longest route a quick survey may suggest, metres. Well past any single
 * battery at survey speed; a larger box is a zoomed-out viewport, not a job.
 */
export const QUICK_SURVEY_MAX_PATH_M = 50_000;

// ── Tunable defaults (documented, no magic numbers elsewhere) ──

/** Default cruise speed for a suggested survey, m/s. */
const DEFAULT_SURVEY_SPEED_MS = 5;
/** Default overshoot past each transect end so turns clear the boundary, m. */
const DEFAULT_TURN_AROUND_M = 10;
/**
 * No-camera fallback: assume the ground footprint width roughly equals the
 * flight altitude. That holds for a typical ~53-degree horizontal field of
 * view (footprint = 2 * alt * tan(FOV/2) ~= alt). Used only when no camera
 * profile is given.
 */
const ASSUMED_FOOTPRINT_TO_ALT_RATIO = 1.0;
/** Never suggest a spacing tighter than this, m. */
const MIN_LINE_SPACING_M = 1;
/** Cap overlap so spacing can never collapse to zero. */
const MAX_OVERLAP_FRACTION = 0.9;

// ── Helpers ──────────────────────────────────────────────────

/** Normalize an overlap percentage (0-100) to a safe fraction (0..0.9). */
function overlapToFraction(overlapPct: number): number {
  if (!Number.isFinite(overlapPct) || overlapPct <= 0) return 0;
  const fraction = overlapPct / 100;
  return Math.min(Math.max(fraction, 0), MAX_OVERLAP_FRACTION);
}

/** Sort a bbox so north>=south and east>=west (antimeridian spans not handled). */
function normalizeBounds(bounds: MapBounds): MapBounds {
  return {
    north: Math.max(bounds.north, bounds.south),
    south: Math.min(bounds.north, bounds.south),
    east: Math.max(bounds.east, bounds.west),
    west: Math.min(bounds.east, bounds.west),
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Build a survey polygon and suggested config that blankets the given bbox.
 *
 * @param bounds  Map viewport bounds in degrees.
 * @param options Altitude, desired overlap percentage, optional camera.
 * @returns The four-corner polygon and a full {@link SurveyConfig}.
 */
export function quickSurveyFromBounds(
  bounds: MapBounds,
  options: QuickSurveyOptions,
): QuickSurveyResult {
  const b = normalizeBounds(bounds);
  const altitude = Math.max(options.altitudeM, 0);
  const overlap = overlapToFraction(options.overlapPct);

  // Clockwise polygon from the top-left corner.
  const polygon: [number, number][] = [
    [b.north, b.west],
    [b.north, b.east],
    [b.south, b.east],
    [b.south, b.west],
  ];

  // Physical span of the box, so we can run lines along the longer axis.
  const midLat = (b.north + b.south) / 2;
  const midLon = (b.east + b.west) / 2;
  const widthM = haversineDistance(midLat, b.west, midLat, b.east); // east-west
  const heightM = haversineDistance(b.north, midLon, b.south, midLon); // north-south

  // Fewer transects = run the survey lines ALONG the longer axis (so they step
  // across the shorter one). The generator's convention is gridAngle 0 = east-west
  // lines, 90 = north-south lines. So a wide box (east-west is the longer axis)
  // wants east-west lines (gridAngle 0); a tall box wants north-south (gridAngle 90).
  const gridAngle = widthM >= heightM ? 0 : 90;

  // Line spacing from the camera footprint when available, else altitude-based.
  const cameraLineSpacing = options.camera
    ? computeLineSpacing(altitude, options.camera, overlap)
    : altitude * ASSUMED_FOOTPRINT_TO_ALT_RATIO * (1 - overlap);
  const lineSpacing = Math.max(cameraLineSpacing, MIN_LINE_SPACING_M);

  // Camera trigger distance uses the along-track footprint at the same overlap.
  const cameraTriggerDistance = options.camera
    ? Math.max(computeTriggerDistance(altitude, options.camera, overlap), 0)
    : 0;

  const config: SurveyConfig = {
    polygon,
    gridAngle,
    lineSpacing,
    turnAroundDistance: DEFAULT_TURN_AROUND_M,
    entryLocation: "topLeft",
    flyAlternateTransects: false,
    cameraTriggerDistance,
    tieLines: false,
    tieLineAngle: 90,
    tieLineSpacing: lineSpacing,
    altitude,
    speed: DEFAULT_SURVEY_SPEED_MS,
  };

  const longSideM = Math.max(widthM, heightM);
  const shortSideM = Math.min(widthM, heightM);
  const transects = Math.floor(shortSideM / lineSpacing) + 1;
  const estimate: QuickSurveyEstimate = {
    transects,
    items: transects * (cameraTriggerDistance > 0 ? 4 : 2),
    pathLengthM: transects * (longSideM + 2 * DEFAULT_TURN_AROUND_M) + (transects - 1) * lineSpacing,
  };

  return { polygon, config, estimate };
}
