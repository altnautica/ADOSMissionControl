/**
 * @module ReplayMap
 * @description Leaflet map for flight replay. Shows drone marker (rotated by heading),
 * progressive trail, and home marker. Auto-follows drone position.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore, type TrailPoint } from "@/stores/trail-store";
import { Crosshair } from "lucide-react";
import "leaflet/dist/leaflet.css";

const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const DARK_ATTR = '&copy; <a href="https://carto.com/">CARTO</a>';

// ── Drone Icon ───────────────────────────────────────────

function makeDroneIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<svg width="28" height="28" viewBox="0 0 28 28" style="transform:rotate(${heading}deg)">
      <polygon points="14,4 22,24 14,19 6,24" fill="#3A82FF" fill-opacity="0.9" stroke="#3A82FF" stroke-width="1"/>
    </svg>`,
  });
}

const homeIcon = L.divIcon({
  className: "",
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  html: `<svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6" fill="none" stroke="#3A82FF" stroke-width="1.5" stroke-dasharray="3 2"/>
    <circle cx="8" cy="8" r="2" fill="#3A82FF"/>
  </svg>`,
});

// ── Map Follower ─────────────────────────────────────────

function MapFollower({ position, enabled }: { position: [number, number] | null; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (enabled && position) {
      map.setView(position, map.getZoom(), { animate: true, duration: 0.3 });
    }
  }, [map, position, enabled]);
  return null;
}

// ── Main Component ───────────────────────────────────────

export function ReplayMap() {
  const posBuffer = useTelemetryStore((s) => s.position);
  const trailVersion = useTrailStore((s) => s._version);
  const trailRing = useTrailStore((s) => s._ring);

  const pos = posBuffer.latest();
  const [autoFollow, setAutoFollow] = useState(true);

  const dronePos: [number, number] | null = pos && pos.lat !== 0
    ? [pos.lat, pos.lon]
    : null;

  const droneIcon = useMemo(
    () => makeDroneIcon(pos?.heading ?? 0),
    [pos?.heading],
  );

  // Trail as positions array
  const trailPositions = useMemo(() => {
    // trailVersion used for reactivity
    void trailVersion;
    return trailRing.toArray().map((p: TrailPoint) => [p.lat, p.lon] as [number, number]);
  }, [trailRing, trailVersion]);

  // Home position (first trail point)
  const homePos = trailPositions.length > 0 ? trailPositions[0] : null;

  // Default center
  const defaultCenter: [number, number] = dronePos ?? homePos ?? [12.97, 77.59]; // Bangalore fallback

  // Disable auto-follow on user drag
  const handleMapDrag = useCallback(() => setAutoFollow(false), []);

  return (
    <div className="relative flex-1">
      <MapContainer
        center={defaultCenter}
        zoom={16}
        className="h-full w-full"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={DARK_TILES} attribution={DARK_ATTR} />
        <MapFollower position={dronePos} enabled={autoFollow} />
        <MapDragDetector onDrag={handleMapDrag} />

        {/* Trail */}
        {trailPositions.length >= 2 && (
          <Polyline
            positions={trailPositions}
            pathOptions={{ color: "#3A82FF", weight: 2.5, opacity: 0.8 }}
          />
        )}

        {/* Home marker */}
        {homePos && <Marker position={homePos} icon={homeIcon} interactive={false} />}

        {/* Drone marker */}
        {dronePos && <Marker position={dronePos} icon={droneIcon} interactive={false} />}
      </MapContainer>

      {/* Re-center button (shown when auto-follow disabled) */}
      {!autoFollow && (
        <button
          onClick={() => setAutoFollow(true)}
          className="absolute bottom-3 right-3 z-[1000] flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-text-secondary bg-bg-primary/90 border border-border-default rounded hover:text-text-primary transition-colors cursor-pointer"
        >
          <Crosshair size={12} />
          Re-center
        </button>
      )}
    </div>
  );
}

// ── Map Drag Detector ────────────────────────────────────

function MapDragDetector({ onDrag }: { onDrag: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on("dragstart", onDrag);
    return () => { map.off("dragstart", onDrag); };
  }, [map, onDrag]);
  return null;
}
