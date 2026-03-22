/**
 * @module AirspaceVolumeEntities
 * @description Renders airspace zones as semi-transparent extruded 3D volumes on the CesiumJS globe.
 * Color and opacity follow aviation standard color scheme from ZONE_COLORS.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import { Cartesian3, Color, DistanceDisplayCondition, PolygonHierarchy, type Viewer as CesiumViewer, type Entity as CesiumEntity } from "cesium";
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

    for (const zone of zones) {
      if (zone.floorAltitude > operationalAltitude) continue;
      if (zone.metadata?.generated === "icao-standard" && !showIcaoZones) continue;
      if (zone.jurisdiction && !activeJurisdictions.has(zone.jurisdiction)) continue;
      const colors = getVolumeColors(zone.type);
      if (!colors) continue;

      const lodDistance = getZoneLodDistance(zone.type, zone.ceilingAltitude);
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
            distanceDisplayCondition: new DistanceDisplayCondition(0, lodDistance),
          },
          description,
        });

        entityMapRef.current.set(entityId, entity);
      } else {
        const polygons = extractPolygons(zone.geometry);

        for (let i = 0; i < polygons.length; i++) {
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
              distanceDisplayCondition: new DistanceDisplayCondition(0, lodDistance),
            },
            description,
          });

          entityMapRef.current.set(entityId, entity);
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

/** Returns max camera distance (meters) at which this zone type should be visible. */
function getZoneLodDistance(type: string, _ceilingAlt: number): number {
  switch (type) {
    // Small zones (~5km radius): visible below 100km
    case "dgcaRed":
    case "casaRestricted":
      return 100_000;
    // Medium zones (~9-25km radius): visible below 250km
    case "dgcaYellow":
    case "classD":
    case "casaCaution":
    case "moa":
      return 250_000;
    // Large zones (~45-55km radius): visible below 500km
    case "dgcaGreen":
    case "classB":
    case "classC":
    case "classE":
      return 500_000;
    // Restrictions and TFRs: visible below 300km
    case "restricted":
    case "prohibited":
    case "tfr":
    case "ctr":
    case "tma":
      return 300_000;
    // Danger/Alert/Warning: visible below 250km
    case "danger":
    case "alert":
    case "warning":
      return 250_000;
    default:
      return 300_000;
  }
}

function extractPolygons(geometry: GeoJSONPolygon | GeoJSONMultiPolygon): number[][][] {
  if (geometry.type === "Polygon") {
    return [geometry.coordinates[0]];
  }
  return geometry.coordinates.map((poly) => poly[0]);
}
