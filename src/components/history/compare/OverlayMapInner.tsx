"use client";

/**
 * N-flight map overlay — renders 2–5 flight paths with color cycling.
 *
 * Dynamic-imported with `ssr: false`.
 *
 * Phase 18 — extends CompareMapInner to N flights.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FlightRecord } from "@/lib/types";

const COLORS = [
  "#3a82ff", "#dff140", "#22c55e", "#ef4444", "#a855f7",
];

function makeIcon(color: string, round: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:10px;height:10px;${round ? "border-radius:50%;" : ""}border:2px solid #0a0a0f"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function FitToBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
  }, [bounds, map]);
  return null;
}

interface OverlayMapInnerProps {
  records: FlightRecord[];
}

export default function OverlayMapInner({ records }: OverlayMapInnerProps) {
  const paths = useMemo(
    () => records.map((r) => r.path ?? []),
    [records],
  );

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const all = paths.flat();
    return all.length >= 2 ? all : null;
  }, [paths]);

  const center: [number, number] = paths[0]?.[0] ?? [0, 0];

  return (
    <div className="h-[360px] w-full overflow-hidden rounded border border-border-default">
      <MapContainer center={center} zoom={15} scrollWheelZoom className="h-full w-full bg-bg-tertiary">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={20}
        />
        {records.map((r, i) => {
          const color = COLORS[i % COLORS.length];
          const path = r.path ?? [];
          return (
            <span key={r.id}>
              {path.length >= 2 && (
                <Polyline positions={path} pathOptions={{ color, weight: 3, opacity: 0.85 }} />
              )}
              {r.takeoffLat !== undefined && r.takeoffLon !== undefined && (
                <Marker position={[r.takeoffLat, r.takeoffLon]} icon={makeIcon(color, true)} />
              )}
              {r.landingLat !== undefined && r.landingLon !== undefined && (
                <Marker position={[r.landingLat, r.landingLon]} icon={makeIcon(color, false)} />
              )}
            </span>
          );
        })}
        <FitToBounds bounds={bounds} />
      </MapContainer>
    </div>
  );
}
