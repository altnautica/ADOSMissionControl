"use client";

/**
 * Inner Leaflet map for the History compare modal — both flight paths on
 * one map with distinct colours.
 *
 * Dynamic-imported with `ssr: false` (mirrors `MapTabInner`).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FlightRecord } from "@/lib/types";

const ICONS = {
  takeoffA: L.divIcon({
    className: "ados-history-marker",
    html: `<div style="background:#3a82ff;width:12px;height:12px;border-radius:50%;border:2px solid #0a0a0f"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }),
  landingA: L.divIcon({
    className: "ados-history-marker",
    html: `<div style="background:#3a82ff;width:12px;height:12px;border:2px solid #0a0a0f"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }),
  takeoffB: L.divIcon({
    className: "ados-history-marker",
    html: `<div style="background:#dff140;width:12px;height:12px;border-radius:50%;border:2px solid #0a0a0f"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }),
  landingB: L.divIcon({
    className: "ados-history-marker",
    html: `<div style="background:#dff140;width:12px;height:12px;border:2px solid #0a0a0f"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  }),
};

interface CompareMapInnerProps {
  recordA: FlightRecord;
  recordB: FlightRecord;
}

function FitToBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
  }, [bounds, map]);
  return null;
}

export default function CompareMapInner({ recordA, recordB }: CompareMapInnerProps) {
  const pathA = useMemo<[number, number][]>(() => recordA.path ?? [], [recordA.path]);
  const pathB = useMemo<[number, number][]>(() => recordB.path ?? [], [recordB.path]);

  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const all = [...pathA, ...pathB];
    if (all.length >= 2) return all;
    return null;
  }, [pathA, pathB]);

  const center: [number, number] =
    pathA[0] ?? pathB[0] ?? [recordA.takeoffLat ?? 0, recordA.takeoffLon ?? 0];

  return (
    <div className="h-[320px] w-full overflow-hidden rounded border border-border-default">
      <MapContainer
        center={center}
        zoom={15}
        scrollWheelZoom
        className="h-full w-full bg-bg-tertiary"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={20}
        />
        {pathA.length >= 2 && (
          <Polyline positions={pathA} pathOptions={{ color: "#3a82ff", weight: 3, opacity: 0.9 }} />
        )}
        {pathB.length >= 2 && (
          <Polyline positions={pathB} pathOptions={{ color: "#dff140", weight: 3, opacity: 0.9 }} />
        )}
        {recordA.takeoffLat !== undefined && recordA.takeoffLon !== undefined && (
          <Marker position={[recordA.takeoffLat, recordA.takeoffLon]} icon={ICONS.takeoffA} />
        )}
        {recordA.landingLat !== undefined && recordA.landingLon !== undefined && (
          <Marker position={[recordA.landingLat, recordA.landingLon]} icon={ICONS.landingA} />
        )}
        {recordB.takeoffLat !== undefined && recordB.takeoffLon !== undefined && (
          <Marker position={[recordB.takeoffLat, recordB.takeoffLon]} icon={ICONS.takeoffB} />
        )}
        {recordB.landingLat !== undefined && recordB.landingLon !== undefined && (
          <Marker position={[recordB.landingLat, recordB.landingLon]} icon={ICONS.landingB} />
        )}
        <FitToBounds bounds={bounds} />
      </MapContainer>
    </div>
  );
}
