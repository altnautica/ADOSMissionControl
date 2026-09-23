/**
 * @module RallyPointEntities
 * @description Renders rally (safe return) points in the 3D simulation view.
 * Shows orange markers with labels (R1, R2, R3...) and altitude pillars. A
 * rally altitude is measured from home, so the marker sits at home terrain
 * height plus the altitude; until that datum is known the marker is clamped to
 * the ground and no pillar is drawn.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  VerticalOrigin,
  HorizontalOrigin,
  LabelStyle,
  type Viewer as CesiumViewer,
  type Entity,
} from "cesium";
import { useRallyStore } from "@/stores/rally-store";

interface RallyPointEntitiesProps {
  viewer: CesiumViewer | null;
  /** Terrain height at home (metres above the ellipsoid); undefined until resolved. */
  homeHeight: number | undefined;
  /** Bumps when the terrain provider changes, so ground samples are retaken. */
  terrainVersion: number;
}

const RALLY_COLOR = "#F97316"; // orange
const RALLY_ENTITY_PREFIX = "sim-rally-";

export function RallyPointEntities({ viewer, homeHeight, terrainVersion }: RallyPointEntitiesProps) {
  const points = useRallyStore((s) => s.points);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || points.length === 0) return;

    const entities: Entity[] = [];
    const color = Color.fromCssColorString(RALLY_COLOR);

    for (let i = 0; i < points.length; i++) {
      const rp = points[i];
      const topHeight = homeHeight !== undefined ? homeHeight + rp.alt : undefined;
      const heightReference =
        topHeight !== undefined ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND;

      // Rally point marker
      const marker = viewer.entities.add({
        id: `${RALLY_ENTITY_PREFIX}${rp.id}`,
        position: Cartesian3.fromDegrees(rp.lon, rp.lat, topHeight ?? 0),
        point: {
          pixelSize: 10,
          color,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
          heightReference,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `R${i + 1}`,
          font: "11px Inter, sans-serif",
          fillColor: Color.WHITE,
          style: LabelStyle.FILL,
          outlineWidth: 2,
          outlineColor: Color.BLACK,
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, -16),
          heightReference,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: color.withAlpha(0.8),
          backgroundPadding: new Cartesian2(4, 2),
        },
      });
      entities.push(marker);

      // Altitude pillar from the ground below the rally point to its altitude.
      if (topHeight === undefined) continue;
      const groundHeight = viewer.scene.globe.getHeight(Cartographic.fromDegrees(rp.lon, rp.lat));
      if (groundHeight === undefined) continue;
      const groundPos = Cartesian3.fromDegrees(rp.lon, rp.lat, groundHeight);
      const topPos = Cartesian3.fromDegrees(rp.lon, rp.lat, topHeight);

      const pillar = viewer.entities.add({
        polyline: {
          positions: [groundPos, topPos],
          width: 1,
          material: color.withAlpha(0.4),
          clampToGround: false,
        },
      });
      entities.push(pillar);
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
  }, [viewer, points, homeHeight, terrainVersion]);

  return null;
}
