/**
 * @module ZoneBoundaryEntities
 * @description Renders jurisdiction-specific zone boundaries: India green/yellow/red zones,
 * USA LAANC grid cells, Australia CASA buffer rings. Filtered by current jurisdiction.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useMemo } from "react";
import { Cartesian3, Cartesian2, Color, PolygonHierarchy, ClassificationType, HeightReference, LabelStyle, VerticalOrigin, HorizontalOrigin, DistanceDisplayCondition, type Viewer as CesiumViewer, type Entity as CesiumEntity } from "cesium";
import { useAirspaceStore } from "@/stores/airspace-store";
import { ZONE_COLORS, type AirspaceZone, type AirspaceZoneType } from "@/lib/airspace/types";

interface ZoneBoundaryEntitiesProps {
  viewer: CesiumViewer | null;
}

const JURISDICTION_ZONE_TYPES: Record<string, AirspaceZoneType[]> = {
  dgca: ["dgcaGreen", "dgcaYellow", "dgcaRed", "restricted", "prohibited", "ctr", "tma"],
  faa: ["classB", "classC", "classD", "classE", "restricted", "prohibited", "moa", "danger", "alert", "warning"],
  casa: ["casaRestricted", "casaCaution", "restricted", "prohibited", "danger", "warning"],
  easa: ["classB", "classC", "classD", "classE", "ctr", "tma", "restricted", "prohibited", "danger", "alert", "warning"],
  caa_uk: ["classB", "classC", "classD", "classE", "ctr", "tma", "restricted", "prohibited", "danger", "alert", "warning"],
  caac: ["classB", "classD", "restricted", "prohibited", "danger"],
  jcab: ["classB", "classD", "restricted", "prohibited", "danger"],
  tcca: ["classB", "classC", "classD", "classE", "restricted", "prohibited", "danger", "alert", "warning"],
};

const ZONE_LABEL_TEXT: Record<string, string> = {
  dgcaGreen: "GREEN ZONE", dgcaYellow: "YELLOW ZONE", dgcaRed: "RED ZONE",
  classB: "CLASS B", classC: "CLASS C", classD: "CLASS D", classE: "CLASS E",
  casaRestricted: "RESTRICTED", casaCaution: "CAUTION",
  restricted: "RESTRICTED", prohibited: "PROHIBITED", moa: "MOA", tfr: "TFR",
  ctr: "CTR", tma: "TMA", danger: "DANGER", alert: "ALERT", warning: "WARNING",
};

// Module-level color cache for boundary-specific colors (reduced fill alpha)
const boundaryColorCache = new Map<string, { fill: Color; border: Color }>();
function getBoundaryColors(type: AirspaceZoneType) {
  let cached = boundaryColorCache.get(type);
  if (!cached) {
    const cfg = ZONE_COLORS[type];
    if (!cfg) return null;
    cached = {
      fill: Color.fromCssColorString(cfg.fill).withAlpha(Math.min(cfg.fillOpacity * 0.8, 0.25)),
      border: Color.fromCssColorString(cfg.border).withAlpha(cfg.borderOpacity),
    };
    boundaryColorCache.set(type, cached);
  }
  return cached;
}

const LABEL_BG_COLOR = Color.fromCssColorString("#0a0a0f").withAlpha(0.6);

export function ZoneBoundaryEntities({ viewer }: ZoneBoundaryEntitiesProps) {
  const zones = useAirspaceStore((s) => s.zones);
  const layerVisibility = useAirspaceStore((s) => s.layerVisibility);
  const activeJurisdictions = useAirspaceStore((s) => s.activeJurisdictions);
  const entityMapRef = useRef<Map<string, CesiumEntity>>(new Map());

  // Filter zones to all active jurisdiction boundary types
  const boundaryZones = useMemo(() => {
    const allTypes = new Set<AirspaceZoneType>();
    for (const j of activeJurisdictions) {
      for (const t of (JURISDICTION_ZONE_TYPES[j] ?? [])) {
        allTypes.add(t);
      }
    }
    return zones.filter((z) => allTypes.has(z.type));
  }, [zones, activeJurisdictions]);

  // Effect 1: Toggle entity.show when visibility changes (fast path)
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const visible = layerVisibility.airspace;
    for (const entity of entityMapRef.current.values()) {
      entity.show = visible;
    }
    viewer.scene.requestRender();
  }, [viewer, layerVisibility.airspace]);

  // Effect 2: Create/recreate entities when data changes
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // Remove previous entities
    for (const entity of entityMapRef.current.values()) {
      viewer.entities.remove(entity);
    }
    entityMapRef.current.clear();

    if (!layerVisibility.airspace || boundaryZones.length === 0) {
      viewer.scene.requestRender();
      return;
    }

    const visible = layerVisibility.airspace;

    for (const zone of boundaryZones) {
      const colors = getBoundaryColors(zone.type);
      if (!colors) continue;

      const entityId = `zone-boundary-${zone.id}`;

      if (zone.circle) {
        const entity = viewer.entities.add({
          id: entityId,
          name: zone.name,
          show: visible,
          position: Cartesian3.fromDegrees(zone.circle.lon, zone.circle.lat),
          ellipse: {
            semiMajorAxis: zone.circle.radiusM,
            semiMinorAxis: zone.circle.radiusM,
            material: colors.fill,
            outline: true,
            outlineColor: colors.border,
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            classificationType: ClassificationType.BOTH,
          },
          description: buildDescription(zone),
        });
        entityMapRef.current.set(entityId, entity);
      } else {
        const coords = zone.geometry.type === "Polygon"
          ? zone.geometry.coordinates[0]
          : zone.geometry.coordinates[0][0];

        if (!coords || coords.length < 3) continue;

        const positions = coords.map(([lon, lat]: number[]) =>
          Cartesian3.fromDegrees(lon, lat)
        );

        const entity = viewer.entities.add({
          id: entityId,
          name: zone.name,
          show: visible,
          polygon: {
            hierarchy: new PolygonHierarchy(positions),
            material: colors.fill,
            outline: true,
            outlineColor: colors.border,
            outlineWidth: 2,
            height: 0,
            classificationType: ClassificationType.BOTH,
          },
          description: buildDescription(zone),
        });
        entityMapRef.current.set(entityId, entity);
      }

      // Add center label
      {
        const labelId = `zone-label-${zone.id}`;
        const labelText = ZONE_LABEL_TEXT[zone.type] ?? zone.type.toUpperCase();

        let labelLon: number;
        let labelLat: number;
        if (zone.circle) {
          labelLon = zone.circle.lon;
          labelLat = zone.circle.lat;
        } else {
          const coords = zone.geometry.type === "Polygon"
            ? zone.geometry.coordinates[0]
            : zone.geometry.coordinates[0][0];
          const centroid = computeCentroid(coords);
          labelLon = centroid[0];
          labelLat = centroid[1];
        }

        const labelEntity = viewer.entities.add({
          id: labelId,
          show: visible,
          position: Cartesian3.fromDegrees(labelLon, labelLat),
          label: {
            text: labelText,
            font: "bold 11px monospace",
            fillColor: colors.border,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.CENTER,
            horizontalOrigin: HorizontalOrigin.CENTER,
            disableDepthTestDistance: 5000,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 5_000_000),
            showBackground: true,
            backgroundColor: LABEL_BG_COLOR,
            backgroundPadding: new Cartesian2(6, 3),
          },
        });
        entityMapRef.current.set(labelId, labelEntity);
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
  }, [viewer, boundaryZones]);

  return null;
}

function buildDescription(zone: AirspaceZone): string {
  const meta = Object.entries(zone.metadata)
    .map(([k, v]) => `<p>${k}: ${v}</p>`)
    .join("");
  return `<p><b>${zone.name}</b></p><p>Type: ${zone.type}</p><p>Floor: ${zone.floorAltitude}m / Ceiling: ${zone.ceilingAltitude}m</p><p>Authority: ${zone.authority}</p>${meta}`;
}

function computeCentroid(coords: number[][]): [number, number] {
  let lonSum = 0;
  let latSum = 0;
  const n = coords.length;
  for (const [lon, lat] of coords) {
    lonSum += lon;
    latSum += lat;
  }
  return [lonSum / n, latSum / n];
}
