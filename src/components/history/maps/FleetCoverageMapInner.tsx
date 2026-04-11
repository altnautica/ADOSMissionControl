"use client";

/**
 * Fleet Coverage Map — heatmap + polyline overlay + polygon search.
 *
 * Dynamic-imported with `ssr: false` because react-leaflet uses `window`.
 *
 * Phase 18 — geographic analytics.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FlightRecord } from "@/lib/types";

// ── Heatmap layer (leaflet.heat) ─────────────────────────────

/** Hook that adds/removes a leaflet.heat layer on the map. */
function HeatLayer({ points, show }: { points: [number, number, number][]; show: boolean }) {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (!show || points.length === 0) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    // leaflet.heat attaches L.heatLayer to the L namespace at import time.
    // Dynamic import avoids SSR issues.
    void import("leaflet.heat").then(() => {
      if (layerRef.current) map.removeLayer(layerRef.current);
      const heat = (L as unknown as Record<string, (...args: unknown[]) => L.Layer>).heatLayer(points, {
        radius: 18,
        blur: 20,
        maxZoom: 17,
        gradient: {
          0.2: "#0a0a3f",
          0.4: "#3a82ff",
          0.6: "#22c55e",
          0.8: "#dff140",
          1.0: "#ef4444",
        },
      });
      heat.addTo(map);
      layerRef.current = heat;
    });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, points, show]);

  return null;
}

// ── Polygon search layer ─────────────────────────────────────

function PolygonDrawTool({
  onComplete,
  active,
}: {
  onComplete: (vertices: [number, number][]) => void;
  active: boolean;
}) {
  const map = useMap();
  const verticesRef = useRef<[number, number][]>([]);
  const markersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);

  const cleanup = useCallback(() => {
    for (const m of markersRef.current) map.removeLayer(m);
    markersRef.current = [];
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }
    if (polygonRef.current) {
      map.removeLayer(polygonRef.current);
      polygonRef.current = null;
    }
    verticesRef.current = [];
  }, [map]);

  useEffect(() => {
    if (!active) {
      cleanup();
      return;
    }

    const container = map.getContainer();
    container.style.cursor = "crosshair";

    const handleClick = (e: L.LeafletMouseEvent) => {
      const pt: [number, number] = [e.latlng.lat, e.latlng.lng];
      const verts = verticesRef.current;

      // Close polygon on clicking near first vertex
      if (verts.length >= 3) {
        const first = verts[0];
        const dist = map.latLngToLayerPoint(L.latLng(first)).distanceTo(
          map.latLngToLayerPoint(e.latlng),
        );
        if (dist < 15) {
          // Complete
          onComplete([...verts]);
          cleanup();
          container.style.cursor = "";
          return;
        }
      }

      verts.push(pt);

      // Add vertex marker
      const marker = L.marker(pt, {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:8px;height:8px;background:#dff140;border-radius:50%;border:1px solid #0a0a0f"></div>`,
          iconSize: [8, 8],
          iconAnchor: [4, 4],
        }),
      }).addTo(map);
      markersRef.current.push(marker);

      // Update preview polyline
      if (polylineRef.current) map.removeLayer(polylineRef.current);
      if (verts.length >= 2) {
        polylineRef.current = L.polyline(verts, {
          color: "#dff140",
          weight: 2,
          dashArray: "4 4",
          opacity: 0.7,
        }).addTo(map);
      }
    };

    const handleDblClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      if (verticesRef.current.length >= 3) {
        onComplete([...verticesRef.current]);
        cleanup();
        container.style.cursor = "";
      }
    };

    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off("click", handleClick);
      map.off("dblclick", handleDblClick);
      map.doubleClickZoom.enable();
      container.style.cursor = "";
      cleanup();
    };
  }, [active, map, onComplete, cleanup]);

  return null;
}

// ── Search polygon overlay ───────────────────────────────────

function SearchPolygonOverlay({
  vertices,
  onClear,
}: {
  vertices: [number, number][];
  onClear: () => void;
}) {
  const map = useMap();
  const polygonRef = useRef<L.Polygon | null>(null);

  useEffect(() => {
    if (polygonRef.current) {
      map.removeLayer(polygonRef.current);
      polygonRef.current = null;
    }
    if (vertices.length >= 3) {
      polygonRef.current = L.polygon(vertices, {
        color: "#dff140",
        weight: 2,
        fillColor: "#dff140",
        fillOpacity: 0.1,
      }).addTo(map);
    }
    return () => {
      if (polygonRef.current) {
        map.removeLayer(polygonRef.current);
        polygonRef.current = null;
      }
    };
  }, [vertices, map]);

  if (vertices.length === 0) return null;

  return (
    <div className="absolute top-2 right-2 z-[1000] bg-bg-secondary border border-border-default rounded px-2 py-1 flex items-center gap-1.5">
      <span className="text-[10px] text-text-secondary font-mono">
        Search polygon active
      </span>
      <button
        onClick={onClear}
        className="text-[10px] text-accent-primary hover:underline"
      >
        Clear
      </button>
    </div>
  );
}

// ── Fit bounds helper ────────────────────────────────────────

function FitToBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
  }, [bounds, map]);
  return null;
}

// ── Color palette for N flights ──────────────────────────────

const FLIGHT_COLORS = [
  "#3a82ff", "#dff140", "#22c55e", "#ef4444", "#a855f7",
  "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#f97316",
];

function flightColor(idx: number): string {
  return FLIGHT_COLORS[idx % FLIGHT_COLORS.length];
}

// ── Main component ───────────────────────────────────────────

interface FleetCoverageMapInnerProps {
  records: FlightRecord[];
  onPolygonFilter?: (matchingIds: Set<string>) => void;
}

export default function FleetCoverageMapInner({
  records,
  onPolygonFilter,
}: FleetCoverageMapInnerProps) {
  const [showHeat, setShowHeat] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [searchPoly, setSearchPoly] = useState<[number, number][]>([]);

  // Build heatmap points from all paths
  const heatPoints = useMemo<[number, number, number][]>(() => {
    const pts: [number, number, number][] = [];
    for (const r of records) {
      if (!r.path) continue;
      for (const [lat, lon] of r.path) {
        pts.push([lat, lon, 0.5]); // intensity 0.5
      }
    }
    return pts;
  }, [records]);

  // Compute bounds
  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const all: [number, number][] = [];
    for (const r of records) {
      if (r.path) all.push(...r.path);
      else if (r.takeoffLat !== undefined && r.takeoffLon !== undefined) {
        all.push([r.takeoffLat, r.takeoffLon]);
      }
    }
    if (all.length >= 2) return all;
    return null;
  }, [records]);

  let center: [number, number] = [12.97, 77.59]; // Bangalore fallback
  for (const r of records) {
    if (r.path && r.path.length > 0) { center = r.path[0]; break; }
    if (r.takeoffLat !== undefined && r.takeoffLon !== undefined) {
      center = [r.takeoffLat, r.takeoffLon]; break;
    }
  }

  // Polygon search: find flights whose path crosses the polygon
  const handlePolygonComplete = useCallback(
    (vertices: [number, number][]) => {
      setSearchPoly(vertices);
      setDrawing(false);
      if (!onPolygonFilter) return;

      const matchingIds = new Set<string>();
      for (const r of records) {
        if (!r.path) continue;
        for (const [lat, lon] of r.path) {
          if (pointInPolygon(lat, lon, vertices)) {
            matchingIds.add(r.id);
            break;
          }
        }
      }
      onPolygonFilter(matchingIds);
    },
    [records, onPolygonFilter],
  );

  const handleClearPolygon = useCallback(() => {
    setSearchPoly([]);
    onPolygonFilter?.(new Set());
  }, [onPolygonFilter]);

  // Takeoff markers
  const takeoffIcon = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: `<div style="width:6px;height:6px;background:#22c55e;border-radius:50%;border:1px solid #0a0a0f"></div>`,
        iconSize: [6, 6],
        iconAnchor: [3, 3],
      }),
    [],
  );

  return (
    <div className="relative h-full w-full">
      {/* Layer toggles */}
      <div className="absolute top-2 left-2 z-[1000] flex flex-col gap-1">
        <button
          onClick={() => setShowHeat((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border ${
            showHeat
              ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
              : "bg-bg-secondary border-border-default text-text-secondary"
          }`}
        >
          Heatmap
        </button>
        <button
          onClick={() => setShowPaths((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border ${
            showPaths
              ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
              : "bg-bg-secondary border-border-default text-text-secondary"
          }`}
        >
          Paths
        </button>
        <button
          onClick={() => {
            if (drawing) {
              setDrawing(false);
            } else {
              handleClearPolygon();
              setDrawing(true);
            }
          }}
          className={`text-[10px] px-2 py-0.5 rounded border ${
            drawing
              ? "bg-status-warning/20 border-status-warning text-status-warning"
              : "bg-bg-secondary border-border-default text-text-secondary"
          }`}
        >
          {drawing ? "Cancel draw" : "Search area"}
        </button>
      </div>

      {/* Stats overlay */}
      <div className="absolute bottom-2 left-2 z-[1000] bg-bg-secondary/80 border border-border-default rounded px-2 py-1 text-[10px] font-mono text-text-tertiary">
        {records.length} flights · {heatPoints.length.toLocaleString()} points
      </div>

      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        className="h-full w-full bg-bg-tertiary"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={20}
        />
        <HeatLayer points={heatPoints} show={showHeat} />
        {showPaths &&
          records.map((r, idx) =>
            r.path && r.path.length >= 2 ? (
              <Polyline
                key={r.id}
                positions={r.path}
                pathOptions={{
                  color: flightColor(idx),
                  weight: 2,
                  opacity: 0.6,
                }}
              />
            ) : null,
          )}
        {showPaths &&
          records.map((r) =>
            r.takeoffLat !== undefined && r.takeoffLon !== undefined ? (
              <Marker
                key={`to-${r.id}`}
                position={[r.takeoffLat, r.takeoffLon]}
                icon={takeoffIcon}
              />
            ) : null,
          )}
        <PolygonDrawTool onComplete={handlePolygonComplete} active={drawing} />
        {searchPoly.length >= 3 && (
          <SearchPolygonOverlay vertices={searchPoly} onClear={handleClearPolygon} />
        )}
        <FitToBounds bounds={bounds} />
      </MapContainer>
    </div>
  );
}

// ── Point-in-polygon (ray-casting) ───────────────────────────

function pointInPolygon(
  lat: number,
  lon: number,
  polygon: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
