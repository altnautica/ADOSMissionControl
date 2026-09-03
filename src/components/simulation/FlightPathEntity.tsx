/**
 * @module FlightPathEntity
 * @description Renders the 3D flight path with terrain-resolved altitude,
 * ground track shadow, altitude pillars at waypoints, and distance/altitude labels.
 * Color-codes path segments by command type: transit (blue), survey (green),
 * orbit/ROI (yellow), takeoff/land (white).
 * Falls back to clamped-to-ground path when resolved positions are unavailable.
 * An opt-in "rounded turns" preview (default off) redraws the path polyline with
 * Hermite-smoothed corners. This is a display approximation only: the flight
 * controller flies its own cornering, so it is not a predicted trajectory.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  PolylineDashMaterialProperty,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  DistanceDisplayCondition,
  type Viewer as CesiumViewer,
  type Entity,
} from "cesium";
import type { Waypoint, WaypointCommand } from "@/lib/types";
import { MAP_COLORS } from "@/lib/map-constants";
import { haversineDistance } from "@/lib/telemetry-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { roundCorners, type LatLonAlt } from "@/lib/simulation/spline-path";
import { mslToEllipsoidal } from "@/lib/terrain/geoid";
import { altitudeDatumFor } from "@/lib/mission/altitude-frame";

/**
 * Corner-rounding defaults for the display-only smoothed path.
 * Tension blends the straight leg with the Catmull-Rom curve (0 = straight,
 * 1 = full rounding); samples-per-segment sets the polyline density.
 */
const ROUNDED_TURNS_TENSION = 0.5;
const ROUNDED_TURNS_SAMPLES_PER_SEG = 8;

interface FlightPathEntityProps {
  viewer: CesiumViewer | null;
  waypoints: Waypoint[];
  /** Terrain-resolved absolute positions (includes intermediate sub-samples). */
  resolvedPositions: Cartesian3[] | null;
  /** Indices into resolvedPositions for each original waypoint. */
  waypointIndices?: number[];
  /** Terrain height at each original waypoint (meters above ellipsoid). */
  terrainHeights?: number[];
  /** Show distance and altitude labels at waypoints. Default: true. */
  showLabels?: boolean;
  /** True while terrain provider is loading or resolution is in progress. */
  isResolving?: boolean;
}

/** Format distance as km or m depending on magnitude. */
function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

/** Segment color constants. */
const SEGMENT_COLORS = {
  transit: "#3A82FF",  // blue (accent primary)
  survey: "#22C55E",   // green
  orbit: "#EAB308",    // yellow
  takeoffLand: "#FFFFFF", // white
} as const;

/**
 * Determine the color for a flight segment based on active state commands.
 * Tracks DO_SET_CAM_TRIGG and ROI activation across waypoints.
 */
function getSegmentColor(camTriggerActive: boolean, roiActive: boolean, cmd: WaypointCommand | undefined): Color {
  if (cmd === "TAKEOFF" || cmd === "LAND" || cmd === "RTL") {
    return Color.fromCssColorString(SEGMENT_COLORS.takeoffLand).withAlpha(0.9);
  }
  if (roiActive) {
    return Color.fromCssColorString(SEGMENT_COLORS.orbit).withAlpha(0.9);
  }
  if (camTriggerActive) {
    return Color.fromCssColorString(SEGMENT_COLORS.survey).withAlpha(0.9);
  }
  return Color.fromCssColorString(SEGMENT_COLORS.transit).withAlpha(0.9);
}

/**
 * Absolute altitude (metres above the ellipsoid) for waypoint `i`, used to seed
 * the display-only smoothed path so it sits at the same height as the resolved
 * path. Frame handling matches `resolveAGLToAbsolute` exactly:
 *  - `absolute` is MSL, geoid-corrected, terrain NOT added;
 *  - `relative` is above HOME, so the HOME terrain height is the datum — using
 *    this waypoint's terrain would draw the smoothed path riding over hills the
 *    vehicle would fly into;
 *  - `terrain` is above the ground below the point.
 * Falls back to the resolved cartesian, then to the raw altitude value.
 */
function waypointAbsoluteAlt(
  i: number,
  waypoints: Waypoint[],
  resolvedPositions: Cartesian3[] | null,
  waypointIndices: number[] | undefined,
  terrainHeights: number[] | undefined,
): number {
  const wp = waypoints[i];
  const datum = altitudeDatumFor(wp.frame);
  if (datum === "absolute") return mslToEllipsoidal(wp.alt, wp.lat, wp.lon);
  const terrain = datum === "home" ? terrainHeights?.[0] : terrainHeights?.[i];
  if (terrain !== undefined) return terrain + wp.alt;
  const idx = waypointIndices?.[i];
  if (idx !== undefined && resolvedPositions?.[idx]) {
    const carto = Cartographic.fromCartesian(resolvedPositions[idx]);
    if (carto) return carto.height;
  }
  return wp.alt;
}

/**
 * Check if any waypoints have special commands that warrant color coding.
 */
function hasSpecialCommands(waypoints: Waypoint[]): boolean {
  return waypoints.some(
    (wp) =>
      wp.command === "DO_SET_CAM_TRIGG" ||
      wp.command === "DO_DIGICAM" ||
      wp.command === "ROI" ||
      wp.command === "TAKEOFF" ||
      wp.command === "LAND" ||
      wp.command === "RTL"
  );
}

export function FlightPathEntity({
  viewer,
  waypoints,
  resolvedPositions,
  waypointIndices,
  terrainHeights,
  showLabels = true,
  isResolving = false,
}: FlightPathEntityProps) {
  // Display-only corner smoothing (opt-in, default off). When on, the planned
  // path polyline is drawn with Hermite-rounded turns; the flight controller
  // still flies its own cornering, so this is a preview, not a trajectory.
  const roundedTurnsPreview = useSettingsStore((s) => s.roundedTurnsPreview);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || waypoints.length < 2) return;

    const entities: Entity[] = [];
    const accentColor = Color.fromCssColorString(MAP_COLORS.accentPrimary);
    const mutedColor = Color.fromCssColorString(MAP_COLORS.muted);
    const useColorCoding = hasSpecialCommands(waypoints);

    if (resolvedPositions && resolvedPositions.length >= 2) {
      if (roundedTurnsPreview) {
        // ── Rounded-turns display preview (cosmetic smoothing) ───
        // Seed the smoother with absolute per-waypoint altitude so the curve
        // sits at the same height as the resolved path, then draw one smoothed
        // air polyline plus a smoothed ground track. Pillars/labels below are
        // untouched (they still read the true resolved data).
        const seed: LatLonAlt[] = waypoints.map((wp, i) => ({
          lat: wp.lat,
          lon: wp.lon,
          alt: waypointAbsoluteAlt(
            i,
            waypoints,
            resolvedPositions,
            waypointIndices,
            terrainHeights,
          ),
        }));
        const smoothed = roundCorners(
          seed,
          ROUNDED_TURNS_TENSION,
          ROUNDED_TURNS_SAMPLES_PER_SEG,
        );
        const airPositions = smoothed.map((p) =>
          Cartesian3.fromDegrees(p.lon, p.lat, p.alt),
        );
        const groundPositions = smoothed.map((p) =>
          Cartesian3.fromDegrees(p.lon, p.lat),
        );

        entities.push(
          viewer.entities.add({
            polyline: {
              positions: airPositions,
              width: 3,
              material: accentColor.withAlpha(0.9),
              clampToGround: false,
            },
          }),
        );
        entities.push(
          viewer.entities.add({
            polyline: {
              positions: groundPositions,
              width: 2,
              material: new PolylineDashMaterialProperty({
                color: mutedColor.withAlpha(0.4),
                dashLength: 12,
              }),
              clampToGround: true,
            },
          }),
        );
      } else {
        // ── Color-coded elevated 3D flight path ────────────────────
        if (useColorCoding && waypointIndices && waypointIndices.length === waypoints.length) {
          let camTriggerActive = false;
          let roiActive = false;

          for (let i = 0; i < waypoints.length - 1; i++) {
            const wp = waypoints[i];
            const cmd = wp.command ?? "WAYPOINT";

            // Track state changes
            if (cmd === "DO_SET_CAM_TRIGG") {
              camTriggerActive = (wp.param1 ?? 0) > 0;
            }
            if (cmd === "ROI") {
              roiActive = true;
            }
            if (cmd === "DO_SET_ROI_NONE") {
              roiActive = false;
            }

            const startIdx = waypointIndices[i];
            const endIdx = waypointIndices[i + 1];
            if (startIdx === undefined || endIdx === undefined) continue;

            // Get positions for this segment (including terrain sub-samples)
            const segPositions = resolvedPositions.slice(startIdx, endIdx + 1);
            if (segPositions.length < 2) continue;

            const segColor = getSegmentColor(camTriggerActive, roiActive, cmd);

            const segEntity = viewer.entities.add({
              polyline: {
                positions: segPositions,
                width: 3,
                material: segColor,
                clampToGround: false,
              },
            });
            entities.push(segEntity);
          }
        } else {
          // Single-color fallback
          const pathEntity = viewer.entities.add({
            polyline: {
              positions: resolvedPositions,
              width: 3,
              material: accentColor.withAlpha(0.9),
              clampToGround: false,
            },
          });
          entities.push(pathEntity);
        }

        // ── Ground track (dashed shadow) ─────────────────────────
        const groundTrack = viewer.entities.add({
          polyline: {
            positions: resolvedPositions,
            width: 2,
            material: new PolylineDashMaterialProperty({
              color: mutedColor.withAlpha(0.4),
              dashLength: 12,
            }),
            clampToGround: true,
          },
        });
        entities.push(groundTrack);
      }

      // ── Altitude pillars + labels at each original waypoint ──
      if (waypointIndices && terrainHeights) {
        let cumulativeDistance = 0;

        for (let i = 0; i < waypoints.length; i++) {
          const wp = waypoints[i];
          const posIdx = waypointIndices[i];
          if (posIdx === undefined || !resolvedPositions[posIdx]) continue;

          const topPos = resolvedPositions[posIdx];
          const groundHeight = terrainHeights[i] ?? 0;
          const groundPos = Cartesian3.fromDegrees(wp.lon, wp.lat, groundHeight);

          // Cumulative horizontal distance from start
          if (i > 0) {
            const prev = waypoints[i - 1];
            cumulativeDistance += haversineDistance(
              prev.lat, prev.lon, wp.lat, wp.lon
            );
          }

          // Altitude pillar: thin vertical line from ground to path
          const pillar = viewer.entities.add({
            polyline: {
              positions: [groundPos, topPos],
              width: 1,
              material: mutedColor.withAlpha(0.3),
              clampToGround: false,
            },
          });
          entities.push(pillar);

          // Distance + altitude label
          if (showLabels) {
            const distText = i === 0
              ? "START"
              : formatDistance(cumulativeDistance);
            const altText = `${Math.round(wp.alt)}m AGL`;

            const label = viewer.entities.add({
              position: topPos,
              label: {
                text: `${distText}\n${altText}`,
                font: "11px monospace",
                fillColor: Color.fromCssColorString(MAP_COLORS.foreground).withAlpha(0.8),
                outlineColor: Color.fromCssColorString(MAP_COLORS.background).withAlpha(0.6),
                outlineWidth: 2,
                style: LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: VerticalOrigin.BOTTOM,
                horizontalOrigin: HorizontalOrigin.LEFT,
                pixelOffset: new Cartesian2(8, -4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                distanceDisplayCondition: new DistanceDisplayCondition(0, 15000),
              },
            });
            entities.push(label);
          }
        }
      }
    } else {
      // ── Fallback: clamped-to-ground path ────────────────────
      // When resolving: dashed + low opacity as a loading indicator.
      // Don't pass wp.alt as the third arg to fromDegrees — without
      // terrain context, AGL values become absolute-above-ellipsoid
      // which places the path underground in elevated areas.
      // The rounded-turns preview only reshapes the ground track's lat/lon;
      // altitude is still ignored (clampToGround), so it stays display-only.
      const groundVertices: LatLonAlt[] = roundedTurnsPreview
        ? roundCorners(
            waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon, alt: wp.alt })),
            ROUNDED_TURNS_TENSION,
            ROUNDED_TURNS_SAMPLES_PER_SEG,
          )
        : waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon, alt: wp.alt }));
      const positions = groundVertices.map((p) =>
        Cartesian3.fromDegrees(p.lon, p.lat)
      );

      const pathEntity = viewer.entities.add({
        polyline: {
          positions,
          width: isResolving ? 2 : 3,
          material: isResolving
            ? new PolylineDashMaterialProperty({
                color: accentColor.withAlpha(0.4),
                dashLength: 16,
              })
            : accentColor.withAlpha(0.9),
          clampToGround: true,
        },
      });
      entities.push(pathEntity);
    }

    // Under `requestRenderMode` the scene only paints when something asks it
    // to. An entity mutation Cesium does not observe therefore leaves a STALE
    // frame on screen, which on a flight surface is a false display — so every
    // add and every removal explicitly requests one.
    viewer.scene.requestRender();

    return () => {
      for (const entity of entities) {
        if (!viewer.isDestroyed()) viewer.entities.remove(entity);
      }
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [viewer, waypoints, resolvedPositions, waypointIndices, terrainHeights, showLabels, isResolving, roundedTurnsPreview]);

  return null;
}
