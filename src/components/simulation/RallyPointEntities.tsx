/**
 * @module RallyPointEntities
 * @description Renders rally (safe return) points in the 3D simulation view.
 * Shows orange triangle markers with labels (R1, R2, R3...) and altitude pillars.
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
}

const RALLY_COLOR = "#F97316"; // orange
const RALLY_ENTITY_PREFIX = "sim-rally-";

export function RallyPointEntities({ viewer }: RallyPointEntitiesProps) {
  const points = useRallyStore((s) => s.points);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || points.length === 0) return;

    const entities: Entity[] = [];
    const color = Color.fromCssColorString(RALLY_COLOR);

    for (let i = 0; i < points.length; i++) {
      const rp = points[i];

      // Rally point marker
      const marker = viewer.entities.add({
        id: `${RALLY_ENTITY_PREFIX}${rp.id}`,
        position: Cartesian3.fromDegrees(rp.lon, rp.lat, rp.alt),
        point: {
          pixelSize: 10,
          color,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
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
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: color.withAlpha(0.8),
          backgroundPadding: new Cartesian2(4, 2),
        },
      });
      entities.push(marker);

      // Altitude pillar from ground to rally point (terrain-aware)
      const carto = Cartographic.fromDegrees(rp.lon, rp.lat);
      const terrainHeight = viewer.scene.globe.getHeight(carto) ?? 0;
      const groundPos = Cartesian3.fromDegrees(rp.lon, rp.lat, terrainHeight);
      const topPos = Cartesian3.fromDegrees(rp.lon, rp.lat, terrainHeight + rp.alt);

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
  }, [viewer, points]);

  return null;
}
