/**
 * @module NotamEntities
 * @description Renders NOTAM-affected areas as warning-styled circles or polygons
 * on the CesiumJS globe.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import { Cartesian3, Cartesian2, Color, LabelStyle, VerticalOrigin, DistanceDisplayCondition, type Viewer as CesiumViewer } from "cesium";
import { useAirspaceStore } from "@/stores/airspace-store";

interface NotamEntitiesProps {
  viewer: CesiumViewer | null;
}

export function NotamEntities({ viewer }: NotamEntitiesProps) {
  const notams = useAirspaceStore((s) => s.notams);
  const layerVisibility = useAirspaceStore((s) => s.layerVisibility);
  const entityIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Remove old entities
    for (const id of entityIdsRef.current) {
      viewer.entities.removeById(id);
    }
    entityIdsRef.current = [];

    if (!layerVisibility.restrictions) {
      viewer.scene.requestRender();
      return;
    }

    const newIds: string[] = [];

    for (const notam of notams) {
      if (notam.lat == null || notam.lon == null) continue;

      const entityId = `notam-${notam.id}`;
      const radiusM = (notam.radius ?? 5) * 1000; // default 5km if not specified

      // Skip if entity already exists (prevents duplicate entity crash)
      if (viewer.entities.getById(entityId)) continue;

      viewer.entities.add({
        id: entityId,
        name: notam.title,
        position: Cartesian3.fromDegrees(notam.lon, notam.lat),
        ellipse: {
          semiMajorAxis: radiusM,
          semiMinorAxis: radiusM,
          height: notam.floorAltitude ?? 0,
          extrudedHeight: notam.ceilingAltitude ?? 1000,
          material: Color.fromCssColorString("#FF8C00").withAlpha(0.15),
          outline: true,
          outlineColor: Color.fromCssColorString("#FF8C00").withAlpha(0.6),
          outlineWidth: 1,
        },
        label: {
          text: `NOTAM: ${notam.title}`,
          font: "9px monospace",
          fillColor: Color.fromCssColorString("#FF8C00"),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -10),
          disableDepthTestDistance: 5000,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#0a0a0f").withAlpha(0.7),
          backgroundPadding: new Cartesian2(4, 2),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 200000),
        },
        description: `<p><b>${notam.title}</b></p><p>${notam.text}</p><p>Issuer: ${notam.issuer}</p><p>From: ${notam.effectiveFrom}</p><p>To: ${notam.effectiveTo}</p>`,
      });

      newIds.push(entityId);
    }

    entityIdsRef.current = newIds;
    viewer.scene.requestRender();

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        for (const id of newIds) {
          viewer.entities.removeById(id);
        }
      }
    };
  }, [viewer, notams, layerVisibility.restrictions]);

  return null;
}
