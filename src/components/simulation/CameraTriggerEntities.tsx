/**
 * @module CameraTriggerEntities
 * @description Renders camera trigger markers in the 3D simulation view.
 * Scans waypoints for DO_SET_CAM_TRIGG and DO_DIGICAM commands and renders
 * yellow billboard markers at trigger positions. When camera trigger distance
 * is set, interpolates trigger points along path segments.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  HeightReference,
  VerticalOrigin,
  HorizontalOrigin,
  LabelStyle,
  type Viewer as CesiumViewer,
  type Entity,
} from "cesium";
import type { Waypoint } from "@/lib/types";
import { haversineDistance } from "@/lib/telemetry-utils";

interface CameraTriggerEntitiesProps {
  viewer: CesiumViewer | null;
  waypoints: Waypoint[];
  visible: boolean;
}

interface TriggerPoint {
  lat: number;
  lon: number;
  alt: number;
}

const CAM_ENTITY_PREFIX = "sim-cam-";
const TRIGGER_COLOR = "#EAB308"; // yellow

/**
 * Compute camera trigger points from waypoints.
 * Handles both explicit DO_DIGICAM commands and distance-based triggers
 * set by DO_SET_CAM_TRIGG (param1 = trigger distance in meters).
 */
function computeTriggerPoints(waypoints: Waypoint[]): TriggerPoint[] {
  const points: TriggerPoint[] = [];
  let camTriggerDistance = 0;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];

    if (wp.command === "DO_SET_CAM_TRIGG") {
      // param1 holds the trigger distance in meters
      camTriggerDistance = wp.param1 ?? 0;
      continue;
    }

    if (wp.command === "DO_DIGICAM") {
      // Explicit camera trigger at this position
      points.push({ lat: wp.lat, lon: wp.lon, alt: wp.alt });
      continue;
    }

    // If camera trigger distance is active and we have a previous nav waypoint,
    // interpolate trigger points along the segment
    if (camTriggerDistance > 0 && i > 0) {
      const prev = waypoints[i - 1];
      // Skip non-nav commands for interpolation source
      if (prev.command === "DO_SET_CAM_TRIGG" || prev.command === "DO_DIGICAM") continue;

      const segDist = haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);
      if (segDist <= 0) continue;

      const triggerCount = Math.floor(segDist / camTriggerDistance);
      for (let t = 1; t <= triggerCount; t++) {
        const ratio = (t * camTriggerDistance) / segDist;
        if (ratio > 1) break;
        points.push({
          lat: prev.lat + (wp.lat - prev.lat) * ratio,
          lon: prev.lon + (wp.lon - prev.lon) * ratio,
          alt: prev.alt + (wp.alt - prev.alt) * ratio,
        });
      }
    }
  }

  return points;
}

export function CameraTriggerEntities({ viewer, waypoints, visible }: CameraTriggerEntitiesProps) {
  const triggerPoints = useMemo(() => computeTriggerPoints(waypoints), [waypoints]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !visible || triggerPoints.length === 0) return;

    const entities: Entity[] = [];
    const color = Color.fromCssColorString(TRIGGER_COLOR);

    for (let i = 0; i < triggerPoints.length; i++) {
      const tp = triggerPoints[i];
      const entity = viewer.entities.add({
        id: `${CAM_ENTITY_PREFIX}${i}`,
        position: Cartesian3.fromDegrees(tp.lon, tp.lat, tp.alt),
        point: {
          pixelSize: 6,
          color,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: "\u{1F4F7}",
          font: "14px sans-serif",
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, -12),
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          style: LabelStyle.FILL,
          fillColor: Color.WHITE,
        },
      });
      entities.push(entity);
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
  }, [viewer, triggerPoints, visible]);

  return null;
}

/** Returns the number of camera trigger points for HUD display. */
export function useCameraTriggerCount(waypoints: Waypoint[]): number {
  return useMemo(() => computeTriggerPoints(waypoints).length, [waypoints]);
}
