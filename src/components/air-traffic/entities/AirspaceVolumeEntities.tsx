/**
 * @module AirspaceVolumeEntities
 * @description Renders airspace zones as semi-transparent extruded 3D volumes on the CesiumJS globe.
 * Color and opacity follow aviation standard color scheme from ZONE_COLORS.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import { Cartesian3, Color, PolygonHierarchy, type Viewer as CesiumViewer, type Entity as CesiumEntity } from "cesium";
import { useAirspaceStore } from "@/stores/airspace-store";
import { ZONE_COLORS, type AirspaceZoneType, type GeoJSONPolygon, type GeoJSONMultiPolygon } from "@/lib/airspace/types";

interface AirspaceVolumeEntitiesProps {
  viewer: CesiumViewer | null;
}

function polygonToCartesian(coords: number[][]): Cartesian3[] {
  return coords.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
}

// Module-level color cache — only ~17 zone types, so tiny footprint
const volumeColorCache = new Map<string, { fill: Color; border: Color }>();
function getVolumeColors(type: AirspaceZoneType) {
  let cached = volumeColorCache.get(type);
  if (!cached) {
    const cfg = ZONE_COLORS[type];
    if (!cfg) return null;
    cached = {
      fill: Color.fromCssColorString(cfg.fill).withAlpha(cfg.fillOpacity),
      border: Color.fromCssColorString(cfg.border).withAlpha(cfg.borderOpacity),
    };
    volumeColorCache.set(type, cached);
  }
  return cached;
}

export function AirspaceVolumeEntities({ viewer }: AirspaceVolumeEntitiesProps) {
  const zones = useAirspaceStore((s) => s.zones);
  const layerVisibility = useAirspaceStore((s) => s.layerVisibility);
  const operationalAltitude = useAirspaceStore((s) => s.operationalAltitude);
  const showIcaoZones = useAirspaceStore((s) => s.showIcaoZones);
  const activeJurisdictions = useAirspaceStore((s) => s.activeJurisdictions);
  const entityMapRef = useRef<Map<string, CesiumEntity>>(new Map());

  // Single effect: create/recreate entities when data, filters, or visibility change
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Remove previous entities
    for (const entity of entityMapRef.current.values()) {
      viewer.entities.remove(entity);
    }
    entityMapRef.current.clear();

    if (!layerVisibility.airspace) {
      viewer.scene.requestRender();
      return;
    }

    const visible = layerVisibility.airspace;

    // Performance: sort to prioritize polygons over circles and restricted over advisory,
    // then cap total entities to avoid CesiumJS performance degradation
    const MAX_ENTITIES = 2500;
    let entityCount = 0;

    // Pre-filter and sort: polygons first (they have real boundaries), then by priority
    const PRIORITY_TYPES = new Set(["restricted", "prohibited", "dgcaRed", "danger", "ctr", "tma"]);
    const filtered = zones
      .filter((z) => {
        if (z.floorAltitude > operationalAltitude) return false;
        if (z.metadata?.generated === "icao-standard" && !showIcaoZones) return false;
        if (z.jurisdiction && !activeJurisdictions.has(z.jurisdiction)) return false;
        if (!getVolumeColors(z.type)) return false;
        return true;
      })
      .sort((a, b) => {
        // Polygons (real boundaries) before circles
        const aIsPolygon = !a.circle ? 1 : 0;
        const bIsPolygon = !b.circle ? 1 : 0;
        if (aIsPolygon !== bIsPolygon) return bIsPolygon - aIsPolygon;
        // Priority zone types first
        const aPriority = PRIORITY_TYPES.has(a.type) ? 1 : 0;
        const bPriority = PRIORITY_TYPES.has(b.type) ? 1 : 0;
        return bPriority - aPriority;
      });

    for (const zone of filtered) {
      if (entityCount >= MAX_ENTITIES) break;
      const colors = getVolumeColors(zone.type);
      if (!colors) continue;

      const description = `<p><b>${zone.name}</b></p><p>Type: ${zone.type}</p><p>Floor: ${zone.floorAltitude}m / Ceiling: ${zone.ceilingAltitude}m</p><p>Authority: ${zone.authority}</p>`;

      if (zone.circle) {
        const entityId = `airspace-volume-${zone.id}-0`;
        const extrudedHeight = Math.max(zone.ceilingAltitude, 1);

        const entity = viewer.entities.add({
          id: entityId,
          name: zone.name,
          show: visible,
          position: Cartesian3.fromDegrees(zone.circle.lon, zone.circle.lat),
          ellipse: {
            semiMajorAxis: zone.circle.radiusM,
            semiMinorAxis: zone.circle.radiusM,
            height: zone.floorAltitude,
            extrudedHeight,
            material: colors.fill,
            outline: true,
            outlineColor: colors.border,
            outlineWidth: 2,
          },
          description,
        });

        entityMapRef.current.set(entityId, entity);
        entityCount++;
      } else {
        const polygons = extractPolygons(zone.geometry);

        for (let i = 0; i < polygons.length; i++) {
          if (entityCount >= MAX_ENTITIES) break;
          const ring = polygons[i];
          if (ring.length < 3) continue;

          const entityId = `airspace-volume-${zone.id}-${i}`;
          const positions = polygonToCartesian(ring);

          const entity = viewer.entities.add({
            id: entityId,
            name: zone.name,
            show: visible,
            polygon: {
              hierarchy: new PolygonHierarchy(positions),
              height: zone.floorAltitude,
              extrudedHeight: zone.ceilingAltitude,
              material: colors.fill,
              outline: true,
              outlineColor: colors.border,
              outlineWidth: 2,
              closeTop: true,
              closeBottom: true,
            },
            description,
          });

          entityMapRef.current.set(entityId, entity);
          entityCount++;
        }
      }
    }

    viewer.scene.requestRender();

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        for (const entity of entityMapRef.current.values()) {
          viewer.entities.remove(entity);
        }
        entityMapRef.current.clear();
      }
    };
  }, [viewer, zones, operationalAltitude, showIcaoZones, activeJurisdictions, layerVisibility.airspace]);

  return null;
}

function extractPolygons(geometry: GeoJSONPolygon | GeoJSONMultiPolygon): number[][][] {
  if (geometry.type === "Polygon") {
    return [geometry.coordinates[0]];
  }
  return geometry.coordinates.map((poly) => poly[0]);
}
