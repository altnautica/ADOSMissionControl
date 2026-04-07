"use client";

/**
 * Inner Leaflet map for the History detail Map tab.
 *
 * Pulled into a separate file because react-leaflet uses `window` and must be
 * dynamic-imported with `ssr: false`. Phase 4a — single-color polyline +
 * takeoff/landing markers. Phase 4b will add altitude colorization, mission
 * overlay, photo markers, and replay cursor sync.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FlightRecord } from "@/lib/types";

const TAKEOFF_ICON = L.divIcon({
  className: "ados-history-marker",
  html: `<div style="background:#22c55e;width:14px;height:14px;border-radius:50%;border:2px solid #0a0a0f;box-shadow:0 0 0 1px #22c55e"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const LANDING_ICON = L.divIcon({
  className: "ados-history-marker",
  html: `<div style="background:#ef4444;width:14px;height:14px;border-radius:50%;border:2px solid #0a0a0f;box-shadow:0 0 0 1px #ef4444"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

interface MapTabInnerProps {
  record: FlightRecord;
}

function FitToBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
    }
  }, [bounds, map]);
  return null;
}

export default function MapTabInner({ record }: MapTabInnerProps) {
  const path = useMemo<[number, number][]>(() => record.path ?? [], [record.path]);
  const hasPath = path.length >= 2;

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    if (hasPath) return path;
    if (record.takeoffLat !== undefined && record.takeoffLon !== undefined) {
      return [[record.takeoffLat, record.takeoffLon]];
    }
    return null;
  }, [hasPath, path, record.takeoffLat, record.takeoffLon]);

  const initialCenter: [number, number] = hasPath
    ? path[0]
    : [record.takeoffLat ?? 0, record.takeoffLon ?? 0];

  return (
    <div className="h-[320px] w-full overflow-hidden rounded border border-border-default">
      <MapContainer
        center={initialCenter}
        zoom={15}
        scrollWheelZoom
        className="h-full w-full bg-bg-tertiary"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={20}
        />
        {hasPath && (
          <Polyline
            positions={path as [number, number][]}
            pathOptions={{ color: "#3a82ff", weight: 3, opacity: 0.9 }}
          />
        )}
        {record.takeoffLat !== undefined && record.takeoffLon !== undefined && (
          <Marker
            position={[record.takeoffLat, record.takeoffLon]}
            icon={TAKEOFF_ICON}
          />
        )}
        {record.landingLat !== undefined && record.landingLon !== undefined && (
          <Marker
            position={[record.landingLat, record.landingLon]}
            icon={LANDING_ICON}
          />
        )}
        <FitToBounds bounds={bounds} />
      </MapContainer>
    </div>
  );
}
