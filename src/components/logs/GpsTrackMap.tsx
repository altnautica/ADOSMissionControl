"use client";

/**
 * @module GpsTrackMap
 * @description Mini GPS track map showing recorded lat/lon positions as a
 * polyline. Reads from trail-store. Uses react-leaflet (dynamic import,
 * same pattern as OverviewMap).
 * @license GPL-3.0-only
 */

import { useMemo, useEffect, useRef } from "react";
import { useTrailStore } from "@/stores/trail-store";
import { MapPin } from "lucide-react";
import { MapContainer, Polyline, CircleMarker, useMap } from "react-leaflet";
import dynamic from "next/dynamic";
import L from "leaflet";

const TileLayerSwitcher = dynamic(
  () =>
    import("@/components/map/TileLayerSwitcher").then((m) => ({
      default: m.TileLayerSwitcher,
    })),
  { ssr: false }
);

const FALLBACK_CENTER: [number, number] = [0, 0];

/**
 * Fit the map to the trail as it grows, until the operator pans or zooms:
 * after that the view is theirs and new points no longer snap it back.
 */
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const userMoved = useRef(false);

  useEffect(() => {
    const container = map.getContainer();
    const mark = () => {
      userMoved.current = true;
    };
    container.addEventListener("pointerdown", mark);
    container.addEventListener("wheel", mark, { passive: true });
    return () => {
      container.removeEventListener("pointerdown", mark);
      container.removeEventListener("wheel", mark);
    };
  }, [map]);

  useEffect(() => {
    if (userMoved.current || positions.length < 2) return;
    map.fitBounds(L.latLngBounds(positions), { padding: [20, 20], maxZoom: 18 });
  }, [map, positions]);

  return null;
}

export function GpsTrackMap() {
  const ring = useTrailStore((s) => s._ring);
  const trailVersion = useTrailStore((s) => s._version);

  // The ring mutates in place; the version is the trigger. Everything is
  // derived once per new point, not on every render.
  const { positions, totalDist, maxAlt } = useMemo(() => {
    void trailVersion;
    const trail = ring.toArray();
    let dist = 0;
    let alt = 0;
    for (let i = 0; i < trail.length; i++) {
      const curr = trail[i];
      if (curr.alt > alt) alt = curr.alt;
      if (i === 0) continue;
      const prev = trail[i - 1];
      const dlat = (curr.lat - prev.lat) * 111320;
      const dlon = (curr.lon - prev.lon) * 111320 * Math.cos((prev.lat * Math.PI) / 180);
      dist += Math.sqrt(dlat * dlat + dlon * dlon);
    }
    return {
      positions: trail.map((p): [number, number] => [p.lat, p.lon]),
      totalDist: dist,
      maxAlt: alt,
    };
  }, [ring, trailVersion]);

  const startPos = positions.length > 0 ? positions[0] : null;
  const endPos = positions.length > 1 ? positions[positions.length - 1] : null;
  const center = startPos ?? FALLBACK_CENTER;

  return (
    <div className="border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <MapPin size={12} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">
          GPS Track
        </span>
        <span className="text-[9px] font-mono text-text-tertiary ml-auto">
          {positions.length} pts
          {totalDist > 0 &&
            ` / ${totalDist > 1000 ? (totalDist / 1000).toFixed(2) + "km" : totalDist.toFixed(0) + "m"}`}
          {maxAlt > 0 && ` / max ${maxAlt.toFixed(0)}m`}
        </span>
      </div>

      {positions.length < 2 ? (
        <div
          className="flex items-center justify-center bg-bg-tertiary/30 rounded"
          style={{ height: 200 }}
        >
          <span className="text-[10px] text-text-tertiary">
            Waiting for GPS data...
          </span>
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ height: 200 }}>
          <MapContainer
            center={center}
            zoom={15}
            className="w-full h-full"
            zoomControl={false}
            style={{ background: "#0a0a0a" }}
          >
            <TileLayerSwitcher />
            <FitBounds positions={positions} />

            <Polyline
              positions={positions}
              pathOptions={{
                color: "#3A82FF",
                weight: 2,
                opacity: 0.8,
              }}
            />

            {/* Start marker — green */}
            {startPos && (
              <CircleMarker
                center={startPos}
                radius={4}
                pathOptions={{
                  color: "#22c55e",
                  fillColor: "#22c55e",
                  fillOpacity: 1,
                  weight: 1,
                }}
              />
            )}

            {/* End marker — red */}
            {endPos && (
              <CircleMarker
                center={endPos}
                radius={4}
                pathOptions={{
                  color: "#ef4444",
                  fillColor: "#ef4444",
                  fillOpacity: 1,
                  weight: 1,
                }}
              />
            )}
          </MapContainer>
        </div>
      )}
    </div>
  );
}
