/**
 * @module CameraTriggerEntities
 * @description Renders camera trigger markers in the 3D simulation view from
 * the DO_SET_CAM_TRIGG and DO_DIGICAM actions attached to the waypoints.
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
import { computeTriggerPoints } from "@/lib/simulation/mission-action-state";

interface CameraTriggerEntitiesProps {
  viewer: CesiumViewer | null;
  waypoints: Waypoint[];
  visible: boolean;
}

const CAM_ENTITY_PREFIX = "sim-cam-";
const TRIGGER_COLOR = "#EAB308"; // yellow

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
