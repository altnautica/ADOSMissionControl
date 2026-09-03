/**
 * @module PatternBoundaryEntities
 * @description Renders pattern boundary visualizations in the 3D simulation view.
 * Shows survey polygon (green), orbit circle (yellow), and corridor boundary (blue)
 * as translucent ground overlays.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import {
  Cartesian3,
  Color,
  HeightReference,
  PolygonHierarchy,
  type Viewer as CesiumViewer,
  type Entity,
} from "cesium";
import { usePatternStore } from "@/stores/pattern-store";

interface PatternBoundaryEntitiesProps {
  viewer: CesiumViewer | null;
}

const SURVEY_COLOR = "#22C55E"; // green
const ORBIT_COLOR = "#EAB308"; // yellow
const CORRIDOR_COLOR = "#3A82FF"; // blue

export function PatternBoundaryEntities({ viewer }: PatternBoundaryEntitiesProps) {
  const activePatternType = usePatternStore((s) => s.activePatternType);
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const corridorConfig = usePatternStore((s) => s.corridorConfig);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !activePatternType) return;

    const entities: Entity[] = [];

    // Survey polygon boundary
    if (activePatternType === "survey" && surveyConfig.polygon && surveyConfig.polygon.length >= 3) {
      const positions = surveyConfig.polygon.map(([lat, lon]) =>
        Cartesian3.fromDegrees(lon, lat)
      );

      const polyEntity = viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          material: Color.fromCssColorString(SURVEY_COLOR).withAlpha(0.15),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outline: true,
          outlineColor: Color.fromCssColorString(SURVEY_COLOR).withAlpha(0.5),
        },
      });
      entities.push(polyEntity);
    }

    // Orbit circle boundary
    if (activePatternType === "orbit" && orbitConfig.center) {
      const [lat, lon] = orbitConfig.center;
      const radius = orbitConfig.radius ?? 50;

      const circleEntity = viewer.entities.add({
        position: Cartesian3.fromDegrees(lon, lat),
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: Color.fromCssColorString(ORBIT_COLOR).withAlpha(0.15),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outline: true,
          outlineColor: Color.fromCssColorString(ORBIT_COLOR).withAlpha(0.5),
        },
      });
      entities.push(circleEntity);
    }

    // Corridor boundary
    if (activePatternType === "corridor" && corridorConfig.pathPoints && corridorConfig.pathPoints.length >= 2) {
      const halfWidth = (corridorConfig.corridorWidth ?? 50) / 2;
      const pathPts = corridorConfig.pathPoints;

      // Build corridor boundary polygon by offsetting path points
      const leftSide: Cartesian3[] = [];
      const rightSide: Cartesian3[] = [];

      for (let i = 0; i < pathPts.length; i++) {
        const [lat, lon] = pathPts[i];
        // Approximate perpendicular offset in degrees
        let bearing = 0;
        if (i < pathPts.length - 1) {
          const [nextLat, nextLon] = pathPts[i + 1];
          bearing = Math.atan2(nextLon - lon, nextLat - lat);
        } else if (i > 0) {
          const [prevLat, prevLon] = pathPts[i - 1];
          bearing = Math.atan2(lon - prevLon, lat - prevLat);
        }

        const perpAngle = bearing + Math.PI / 2;
        const dLat = (halfWidth / 111320) * Math.cos(perpAngle);
        const dLon = (halfWidth / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(perpAngle);

        leftSide.push(Cartesian3.fromDegrees(lon + dLon, lat + dLat));
        rightSide.push(Cartesian3.fromDegrees(lon - dLon, lat - dLat));
      }

      // Combine into closed polygon: left side forward, right side backward
      const corridorPositions = [...leftSide, ...rightSide.reverse()];

      const corridorEntity = viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(corridorPositions),
          material: Color.fromCssColorString(CORRIDOR_COLOR).withAlpha(0.15),
          heightReference: HeightReference.CLAMP_TO_GROUND,
          outline: true,
          outlineColor: Color.fromCssColorString(CORRIDOR_COLOR).withAlpha(0.5),
        },
      });
      entities.push(corridorEntity);
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
  }, [viewer, activePatternType, surveyConfig, orbitConfig, corridorConfig]);

  return null;
}
