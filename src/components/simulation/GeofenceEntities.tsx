/**
 * @module GeofenceEntities
 * @description Renders geofence boundaries in the 3D simulation view.
 * Shows polygon fence as red translucent polygon, circle fence as red ellipse,
 * and max altitude ceiling as a dashed horizontal plane.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import {
  Cartesian3,
  Cartographic,
  Color,
  HeightReference,
  PolygonHierarchy,
  PolylineDashMaterialProperty,
  type Viewer as CesiumViewer,
  type Entity,
} from "cesium";
import { useGeofenceStore } from "@/stores/geofence-store";

interface GeofenceEntitiesProps {
  viewer: CesiumViewer | null;
}

export function GeofenceEntities({ viewer }: GeofenceEntitiesProps) {
  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const maxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const zones = useGeofenceStore((s) => s.zones);

  useEffect(() => {
    // The primary fence renders only when enabled, but multi-zone fences are
    // explicit keep-in/keep-out areas that render whenever they exist.
    if (!viewer || viewer.isDestroyed() || (!enabled && zones.length === 0)) return;

    const entities: Entity[] = [];
    const fenceColor = Color.RED.withAlpha(0.2);
    const fenceOutlineColor = Color.RED.withAlpha(0.7);

    // Inclusion/exclusion zones (green / red) — independent of the primary fence
    const incColor = Color.fromCssColorString("#22c55e");
    for (const zone of zones) {
      const zColor = zone.role === "exclusion" ? Color.RED : incColor;
      if (zone.type === "polygon" && zone.polygonPoints.length >= 3) {
        const zpos = zone.polygonPoints.map(([lat, lon]) => Cartesian3.fromDegrees(lon, lat));
        entities.push(viewer.entities.add({
          polygon: { hierarchy: new PolygonHierarchy(zpos), material: zColor.withAlpha(0.15), heightReference: HeightReference.CLAMP_TO_GROUND },
        }));
        entities.push(viewer.entities.add({
          polyline: {
            positions: [...zpos, zpos[0]], width: 2, clampToGround: true,
            material: new PolylineDashMaterialProperty({ color: zColor.withAlpha(0.8), dashLength: zone.role === "exclusion" ? 8 : 16 }),
          },
        }));
      } else if (zone.type === "circle" && zone.circleCenter && zone.circleRadius > 0) {
        entities.push(viewer.entities.add({
          position: Cartesian3.fromDegrees(zone.circleCenter[1], zone.circleCenter[0]),
          ellipse: {
            semiMajorAxis: zone.circleRadius, semiMinorAxis: zone.circleRadius,
            material: zColor.withAlpha(0.15), heightReference: HeightReference.CLAMP_TO_GROUND,
            outline: true, outlineColor: zColor.withAlpha(0.8), outlineWidth: 2,
          },
        }));
      }
    }

    if (!enabled) {
      return () => {
        for (const entity of entities) {
          if (!viewer.isDestroyed()) viewer.entities.remove(entity);
        }
      };
    }

    // Polygon geofence
    if (fenceType === "polygon" && polygonPoints.length >= 3) {
      const positions = polygonPoints.map(([lat, lon]) =>
        Cartesian3.fromDegrees(lon, lat)
      );

      // Ground polygon fill
      const polyEntity = viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          material: fenceColor,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
      entities.push(polyEntity);

      // Outline
      const outlineEntity = viewer.entities.add({
        polyline: {
          positions: [...positions, positions[0]], // close the loop
          width: 2,
          material: new PolylineDashMaterialProperty({
            color: fenceOutlineColor,
            dashLength: 12,
          }),
          clampToGround: true,
        },
      });
      entities.push(outlineEntity);
    }

    // Circle geofence
    if (fenceType === "circle" && circleCenter) {
      const centerPos = Cartesian3.fromDegrees(circleCenter[1], circleCenter[0]);

      const circleEntity = viewer.entities.add({
        position: centerPos,
        ellipse: {
          semiMajorAxis: circleRadius,
          semiMinorAxis: circleRadius,
          material: fenceColor,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outline: true,
          outlineColor: fenceOutlineColor,
          outlineWidth: 2,
        },
      });
      entities.push(circleEntity);
    }

    // Max altitude ceiling plane
    if (maxAltitude > 0) {
      // Build a large rectangle at the geofence center to represent the altitude ceiling
      let centerLat = 0;
      let centerLon = 0;

      if (fenceType === "polygon" && polygonPoints.length >= 3) {
        centerLat = polygonPoints.reduce((s, p) => s + p[0], 0) / polygonPoints.length;
        centerLon = polygonPoints.reduce((s, p) => s + p[1], 0) / polygonPoints.length;
      } else if (fenceType === "circle" && circleCenter) {
        centerLat = circleCenter[0];
        centerLon = circleCenter[1];
      }

      if (centerLat !== 0 || centerLon !== 0) {
        // Sample terrain height at fence center so AGL ceiling renders correctly
        const carto = Cartographic.fromDegrees(centerLon, centerLat);
        const terrainHeight = viewer.scene.globe.getHeight(carto) ?? 0;
        const ceilingHeight = terrainHeight + maxAltitude;

        // Represent ceiling as a translucent ellipse at maxAltitude above terrain
        const ceilingEntity = viewer.entities.add({
          position: Cartesian3.fromDegrees(centerLon, centerLat, ceilingHeight),
          ellipse: {
            semiMajorAxis: fenceType === "circle" ? circleRadius : 500,
            semiMinorAxis: fenceType === "circle" ? circleRadius : 500,
            material: Color.RED.withAlpha(0.08),
            outline: true,
            outlineColor: Color.RED.withAlpha(0.3),
            outlineWidth: 1,
            height: ceilingHeight,
          },
        });
        entities.push(ceilingEntity);
      }
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
  }, [viewer, enabled, fenceType, maxAltitude, circleCenter, circleRadius, polygonPoints, zones]);

  return null;
}
