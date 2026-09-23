/**
 * @module templates/mission-templates
 * @description A curated catalog of built-in mission templates. Each template
 * turns the current map view (an optional drawn boundary, otherwise a box
 * around the map center) into REAL waypoints by delegating to the shipped
 * flight-pattern generators in `@/lib/patterns` — no fabricated coordinates.
 *
 * A template is a pure function: given a `MissionTemplateContext` (map center,
 * optional boundary, default altitude, speed and frame) it returns a mission
 * `Waypoint[]` built by the same pattern converter the pattern apply uses, all
 * derived from real generator output. Nothing here reads or mutates a store.
 *
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Waypoint } from "@/lib/types";
import type { PatternResult } from "@/lib/patterns/types";
import { patternToMission } from "@/lib/patterns/pattern-to-mission";
import {
  generateSurvey,
  generateOrbit,
  generateCorridor,
  generateExpandingSquare,
  generateSectorSearch,
} from "@/lib/patterns";
import { offsetPoint } from "@/lib/drawing/geo-utils";

/** Everything a template needs to build real waypoints from the current view. */
export interface MissionTemplateContext {
  /** Current map center as [lat, lon]. */
  center: [number, number];
  /**
   * A drawn boundary polygon ([lat, lon] vertices). Optional — area templates
   * fall back to a box around `center` when it is absent (see `needsBoundary`).
   */
  boundary?: [number, number][];
  /** Default altitude for generated waypoints, in meters, in `frame`. */
  altitude: number;
  /** Default cruise speed for generated waypoints, in m/s. */
  speed: number;
  /** Mission default altitude frame, stamped on every generated waypoint. */
  frame: AltitudeFrame;
}

/** A single built-in mission template. */
export interface MissionTemplate {
  /** Stable id (also the i18n key suffix under `planner.templates`). */
  id: string;
  /** i18n key for the display name, under `planner.templates`. */
  nameKey: string;
  /** i18n key for the one-line description, under `planner.templates`. */
  descKey: string;
  /**
   * True when this template covers an AREA and reads best from a drawn
   * boundary. When no boundary is drawn it still builds (using a box around the
   * map center), but the UI should say so rather than invent one silently.
   */
  needsBoundary: boolean;
  /** Build real waypoints for the current context. Pure, no side effects. */
  build: (ctx: MissionTemplateContext) => Waypoint[];
}

// ── Geometry helpers (real coordinates only) ─────────────────

/** Half-side, in meters, of the default box used when no boundary is drawn. */
const DEFAULT_BOX_HALF_M = 150;

/**
 * The boundary to survey: the drawn polygon when it has at least 3 vertices,
 * otherwise a square box around the map center. The box is a real, visible area
 * derived from the current view — the caller surfaces a hint so it is never a
 * silent invention.
 */
function boundaryOrBox(ctx: MissionTemplateContext): [number, number][] {
  if (ctx.boundary && ctx.boundary.length >= 3) return ctx.boundary;
  return boxAround(ctx.center, DEFAULT_BOX_HALF_M);
}

/** A geodesic square box of the given half-side (meters) centered on a point. */
function boxAround(center: [number, number], halfM: number): [number, number][] {
  const [lat, lon] = center;
  const nw = offsetPoint(lat, lon, 315, halfM * Math.SQRT2);
  const ne = offsetPoint(lat, lon, 45, halfM * Math.SQRT2);
  const se = offsetPoint(lat, lon, 135, halfM * Math.SQRT2);
  const sw = offsetPoint(lat, lon, 225, halfM * Math.SQRT2);
  return [nw, ne, se, sw];
}

// ── Pattern → mission-waypoint conversion ────────────────────

/** Convert a generator result into mission waypoints for this context. */
function finalize(result: PatternResult, ctx: MissionTemplateContext): Waypoint[] {
  return patternToMission(result.waypoints, ctx.frame);
}

// ── The catalog ──────────────────────────────────────────────

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: "gridSurvey",
    nameKey: "gridSurvey.name",
    descKey: "gridSurvey.desc",
    needsBoundary: true,
    build: (ctx) =>
      finalize(
        generateSurvey({
          polygon: boundaryOrBox(ctx),
          gridAngle: 0,
          lineSpacing: 30,
          turnAroundDistance: 10,
          entryLocation: "topLeft",
          flyAlternateTransects: false,
          cameraTriggerDistance: 0,
          altitude: ctx.altitude,
          speed: ctx.speed,
        }),
        ctx,
      ),
  },
  {
    id: "propertyMapping",
    nameKey: "propertyMapping.name",
    descKey: "propertyMapping.desc",
    needsBoundary: true,
    build: (ctx) =>
      finalize(
        // Denser lines, a crosshatch second pass, and camera triggers — the
        // photogrammetry-grade coverage a property map wants.
        generateSurvey({
          polygon: boundaryOrBox(ctx),
          gridAngle: 0,
          lineSpacing: 20,
          turnAroundDistance: 10,
          entryLocation: "topLeft",
          flyAlternateTransects: false,
          cameraTriggerDistance: 15,
          crosshatch: true,
          altitude: ctx.altitude,
          speed: ctx.speed,
        }),
        ctx,
      ),
  },
  {
    id: "orbitInspection",
    nameKey: "orbitInspection.name",
    descKey: "orbitInspection.desc",
    needsBoundary: false,
    build: (ctx) =>
      finalize(
        // Circle the map center as the point of interest.
        generateOrbit({
          center: ctx.center,
          radius: 60,
          direction: "cw",
          turns: 1,
          startAngle: 0,
          altitude: ctx.altitude,
          speed: ctx.speed,
        }),
        ctx,
      ),
  },
  {
    id: "corridorScan",
    nameKey: "corridorScan.name",
    descKey: "corridorScan.desc",
    needsBoundary: false,
    build: (ctx) => {
      // A straight west→east centerline through the map center (~400 m long),
      // scanned as a corridor.
      const [lat, lon] = ctx.center;
      const west = offsetPoint(lat, lon, 270, 200);
      const east = offsetPoint(lat, lon, 90, 200);
      return finalize(
        generateCorridor({
          pathPoints: [west, ctx.center, east],
          corridorWidth: 100,
          lineSpacing: 30,
          altitude: ctx.altitude,
          speed: ctx.speed,
        }),
        ctx,
      );
    },
  },
  {
    id: "areaSearch",
    nameKey: "areaSearch.name",
    descKey: "areaSearch.desc",
    needsBoundary: false,
    build: (ctx) =>
      finalize(
        // Expanding-square SAR pattern outward from the map center as the datum.
        generateExpandingSquare({
          center: ctx.center,
          legSpacing: 40,
          maxLegs: 8,
          altitude: ctx.altitude,
          speed: ctx.speed,
          startBearing: 0,
        }),
        ctx,
      ),
  },
  {
    id: "sectorSearch",
    nameKey: "sectorSearch.name",
    descKey: "sectorSearch.desc",
    needsBoundary: false,
    build: (ctx) =>
      finalize(
        // Pie-slice sector sweeps around the map center as the datum.
        generateSectorSearch({
          center: ctx.center,
          radius: 150,
          sweeps: 3,
          altitude: ctx.altitude,
          speed: ctx.speed,
          startBearing: 0,
        }),
        ctx,
      ),
  },
];
