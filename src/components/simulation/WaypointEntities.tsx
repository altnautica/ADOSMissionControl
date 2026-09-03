/**
 * @module WaypointEntities
 * @description Renders numbered waypoint billboards at their actual altitude in the 3D scene.
 * Clicking a waypoint selects it (syncs with planner store).
 * Entity creation and selection styling are split into separate effects
 * to avoid recreating all entities on selection change.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  HeightReference,
  VerticalOrigin,
  HorizontalOrigin,
  LabelStyle,
  type Viewer as CesiumViewer,
  type Entity,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  defined,
} from "cesium";
import type { Waypoint } from "@/lib/types";
import { MAP_COLORS } from "@/lib/map-constants";
import { usePlannerStore } from "@/stores/planner-store";

interface WaypointEntitiesProps {
  viewer: CesiumViewer | null;
  waypoints: Waypoint[];
  /** Pre-resolved absolute positions from terrain sampling (matches flight path exactly). */
  resolvedPositions?: Cartesian3[];
}

const WP_ENTITY_PREFIX = "sim-wp-";

export function WaypointEntities({ viewer, waypoints, resolvedPositions }: WaypointEntitiesProps) {
  const selectedWaypointId = usePlannerStore((s) => s.selectedWaypointId);
  const entityMapRef = useRef<Map<string, Entity>>(new Map());

  // Effect 1 — Entity creation (only on viewer/waypoints change)
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const entityMap = new Map<string, Entity>();

    // Use resolved positions when available and lengths match, otherwise fall back
    const useResolved =
      resolvedPositions && resolvedPositions.length === waypoints.length;

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const bgColor = Color.fromCssColorString(MAP_COLORS.accentPrimary);

      const position = useResolved
        ? resolvedPositions[i]
        : Cartesian3.fromDegrees(wp.lon, wp.lat, wp.alt);
      const heightRef = useResolved
        ? HeightReference.NONE
        : HeightReference.RELATIVE_TO_GROUND;

      const entity = viewer.entities.add({
        id: `${WP_ENTITY_PREFIX}${wp.id}`,
        position,
        point: {
          pixelSize: 10,
          color: bgColor,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
          heightReference: heightRef,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: String(i + 1),
          font: "12px Inter, sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL,
          outlineWidth: 2,
          outlineColor: Color.BLACK,
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, -16),
          heightReference: heightRef,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: bgColor.withAlpha(0.8),
          backgroundPadding: new Cartesian2(4, 2),
        },
      });
      entityMap.set(wp.id, entity);
    }

    entityMapRef.current = entityMap;

    // Under `requestRenderMode` the scene only paints when something asks it
    // to. An entity mutation Cesium does not observe therefore leaves a STALE
    // frame on screen, which on a flight surface is a false display — so every
    // add and every removal explicitly requests one.
    viewer.scene.requestRender();

    return () => {
      for (const entity of entityMap.values()) {
        if (viewer && !viewer.isDestroyed()) {
          viewer.entities.remove(entity);
        }
      }
      entityMapRef.current = new Map();
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
  }, [viewer, waypoints, resolvedPositions]);

  // Effect 2 — Selection styling (in-place property updates, no entity recreation)
  useEffect(() => {
    const entityMap = entityMapRef.current;
    if (entityMap.size === 0) return;

    const selectedColor = Color.fromCssColorString(MAP_COLORS.accentSelected);
    const defaultColor = Color.fromCssColorString(MAP_COLORS.accentPrimary);
    const selectedTextColor = Color.fromCssColorString(MAP_COLORS.background);

    for (const [wpId, entity] of entityMap) {
      const isSelected = wpId === selectedWaypointId;
      const bgColor = isSelected ? selectedColor : defaultColor;
      const textColor = isSelected ? selectedTextColor : Color.WHITE;

      if (entity.point) {
        entity.point.pixelSize = new ConstantProperty(isSelected ? 14 : 10);
        entity.point.color = new ConstantProperty(bgColor);
        entity.point.outlineWidth = new ConstantProperty(isSelected ? 2 : 1);
      }
      if (entity.label) {
        entity.label.fillColor = new ConstantProperty(textColor);
        entity.label.backgroundColor = new ConstantProperty(bgColor.withAlpha(0.8));
      }
    }
  }, [selectedWaypointId]);

  // Click handler for waypoint selection
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(
      (event: { position: Cartesian2 }) => {
        const picked = viewer.scene.pick(event.position);
        if (defined(picked) && picked.id && typeof picked.id.id === "string" && picked.id.id.startsWith(WP_ENTITY_PREFIX)) {
          const wpId = picked.id.id.replace(WP_ENTITY_PREFIX, "");
          usePlannerStore.getState().setSelectedWaypoint(wpId);
        }
      },
      ScreenSpaceEventType.LEFT_CLICK
    );

    return () => {
      if (!handler.isDestroyed()) handler.destroy();
    };
  }, [viewer]);

  return null;
}
