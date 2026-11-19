/**
 * @module WaypointEntities
 * @description Renders numbered waypoint billboards at their actual altitude in the 3D scene.
 * The number tag is drawn once the terrain-resolved positions arrive; until then
 * the dot is clamped to the ground alone (see scene-label).
 * Clicking a waypoint selects it (syncs with planner store) unless the parent
 * owns input (`selectOnClick={false}`, the planner's 3D view).
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
  type Viewer as CesiumViewer,
  type Entity,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  defined,
} from "cesium";
import type { Waypoint } from "@/lib/types";
import { MAP_COLORS } from "@/lib/map-constants";
import { usePlannerStore } from "@/stores/planner-store";
import { isWaypointSelected } from "@/lib/waypoint-selection";
import { sceneLabel } from "./scene-label";

interface WaypointEntitiesProps {
  viewer: CesiumViewer | null;
  waypoints: Waypoint[];
  /** Pre-resolved absolute positions from terrain sampling (matches flight path exactly). */
  resolvedPositions?: Cartesian3[];
  /** Register the click-to-select handler. Default true. */
  selectOnClick?: boolean;
}

const WP_ENTITY_PREFIX = "sim-wp-";

export function WaypointEntities({ viewer, waypoints, resolvedPositions, selectOnClick = true }: WaypointEntitiesProps) {
  const selectedWaypointId = usePlannerStore((s) => s.selectedWaypointId);
  const selectedWaypointIds = usePlannerStore((s) => s.selectedWaypointIds);
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
        label: sceneLabel(String(i + 1), "12px Inter, sans-serif", bgColor, heightRef),
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

  // Effect 2 — Selection styling (in-place property updates, no entity recreation).
  // It also re-runs after Effect 1 rebuilds the entities (same deps, declared
  // after it), so a rebuild never drops the highlight.
  useEffect(() => {
    const entityMap = entityMapRef.current;
    if (!viewer || viewer.isDestroyed() || entityMap.size === 0) return;

    const selectedColor = Color.fromCssColorString(MAP_COLORS.selected);
    const defaultColor = Color.fromCssColorString(MAP_COLORS.accentPrimary);
    const selectedTextColor = Color.fromCssColorString(MAP_COLORS.background);

    for (const [wpId, entity] of entityMap) {
      const isSelected = isWaypointSelected(wpId, selectedWaypointId, selectedWaypointIds);
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
    viewer.scene.requestRender();
  }, [viewer, waypoints, resolvedPositions, selectedWaypointId, selectedWaypointIds]);

  // Click handler for waypoint selection
  useEffect(() => {
    if (!selectOnClick || !viewer || viewer.isDestroyed()) return;

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
  }, [viewer, selectOnClick]);

  return null;
}
