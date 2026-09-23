/**
 * @module GeozoneMapEditor
 * @description Embedded Leaflet map for drawing polygon geozone boundaries.
 * Wraps the DrawingManager to let operators click vertices directly on the map
 * instead of entering lat/lon numbers by hand.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { DrawingManager } from "@/lib/drawing/drawing-manager";
import type { INavGeozoneVertex } from "@/lib/protocol/msp/msp-decoders-inav";
import { GEOZONE_VERTEX_MAX } from "@/stores/geozone-store";
import { Button } from "@/components/ui/button";
import { MapPin, Trash2, Check, X, RotateCcw } from "lucide-react";
import L from "leaflet";

// ── Types ─────────────────────────────────────────────────────

export interface GeozoneMapEditorProps {
  zoneId: number;
  shape: number;
  currentVertices: INavGeozoneVertex[];
  center?: { lat: number; lon: number };
  maxVertices?: number;
  onCommit: (vertices: INavGeozoneVertex[]) => void;
  onCancel: () => void;
}

// ── Dark tile URL (matches CARTO dark from TileLayerSwitcher) ─

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// ── Shape constants matching geozone-store ────────────────────

const SHAPE_CIRCULAR = 0;
const SHAPE_POLYGON = 1;

// ── Helpers ───────────────────────────────────────────────────

function toLatLngTuples(verts: INavGeozoneVertex[]): [number, number][] {
  return verts.map((v) => [v.lat, v.lon]);
}

function fromLatLngTuples(
  tuples: [number, number][],
  zoneId: number,
): INavGeozoneVertex[] {
  return tuples.map((t, i) => ({
    geozoneId: zoneId,
    vertexIdx: i,
    lat: t[0],
    lon: t[1],
  }));
}

// ── Component ─────────────────────────────────────────────────

export function GeozoneMapEditor({
  zoneId,
  shape,
  currentVertices,
  center,
  maxVertices = GEOZONE_VERTEX_MAX,
  onCommit,
  onCancel,
}: GeozoneMapEditorProps) {
  if (shape === SHAPE_CIRCULAR) {
    return (
      <div className="rounded border border-border-default bg-bg-secondary px-4 py-3 text-[11px] font-mono text-text-tertiary">
        Circular zones use the form editor above.
      </div>
    );
  }

  return (
    <PolygonGeozoneMapEditor
      zoneId={zoneId}
      shape={SHAPE_POLYGON}
      currentVertices={currentVertices}
      center={center}
      maxVertices={maxVertices}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}

function PolygonGeozoneMapEditor({
  zoneId,
  currentVertices,
  center,
  maxVertices = GEOZONE_VERTEX_MAX,
  onCommit,
  onCancel,
}: GeozoneMapEditorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const managerRef = useRef<DrawingManager | null>(null);
  const existingPolyRef = useRef<L.Polygon | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [vertexCount, setVertexCount] = useState(0);
  const [pendingVerts, setPendingVerts] = useState<[number, number][]>([]);

  // Derive initial map center
  const initCenter: [number, number] =
    currentVertices.length > 0
      ? [currentVertices[0].lat, currentVertices[0].lon]
      : center
        ? [center.lat, center.lon]
        : [0, 0];

  const initZoom = currentVertices.length > 0 ? 15 : 4;

  // Mount / unmount the Leaflet map + DrawingManager
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: initCenter,
      zoom: initZoom,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 20 }).addTo(map);

    const manager = new DrawingManager(map, {
      onPolygonComplete: (verts) => {
        setPendingVerts(verts);
        setVertexCount(verts.length);
        setIsDrawing(false);
      },
      onVerticesUpdate: (verts) => {
        setVertexCount(verts.length);
      },
      onCancel: () => {
        setIsDrawing(false);
        setVertexCount(pendingVerts.length);
      },
    });

    mapRef.current = map;
    managerRef.current = manager;

    return () => {
      manager.destroy();
      map.remove();
      mapRef.current = null;
      managerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw the stored polygon whenever currentVertices or pendingVerts change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous static polygon
    if (existingPolyRef.current) {
      existingPolyRef.current.remove();
      existingPolyRef.current = null;
    }

    const tuples =
      pendingVerts.length >= 3
        ? pendingVerts
        : toLatLngTuples(currentVertices);

    if (tuples.length >= 3) {
      existingPolyRef.current = L.polygon(tuples, {
        color: "#3b82f6",
        weight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 0.15,
        opacity: 0.8,
      }).addTo(map);
    }
  }, [currentVertices, pendingVerts]);

  // Sync initial vertex count
  useEffect(() => {
    if (pendingVerts.length === 0) {
      setVertexCount(currentVertices.length);
    }
  }, [currentVertices, pendingVerts.length]);

  function startDraw() {
    const manager = managerRef.current;
    if (!manager) return;
    setPendingVerts([]);
    setVertexCount(0);
    setIsDrawing(true);
    manager.startPolygonDraw();
  }

  function undoVertex() {
    const manager = managerRef.current;
    if (!manager || !isDrawing) return;
    manager.popVertex();
  }

  // This editor owns its DrawingManager, so it also owns the draw keys the
  // footer advertises (the planner's keyboard dispatcher never sees this map).
  useEffect(() => {
    if (!isDrawing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const manager = managerRef.current;
      if (!manager) return;
      if (e.key === "Escape") manager.cancelDraw();
      else if (e.key === "Backspace") manager.popVertex();
      else if (e.key === "Enter") manager.complete();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isDrawing]);

  function cancelDraw() {
    const manager = managerRef.current;
    if (manager && isDrawing) {
      manager.cancelDraw();
    }
    setIsDrawing(false);
    setVertexCount(currentVertices.length);
    setPendingVerts([]);
    onCancel();
  }

  function commitToZone() {
    const vertsToCommit =
      pendingVerts.length >= 3 ? pendingVerts : toLatLngTuples(currentVertices);
    onCommit(fromLatLngTuples(vertsToCommit, zoneId));
  }

  const hasCommittable =
    pendingVerts.length >= 3 ||
    (pendingVerts.length === 0 && currentVertices.length >= 3);

  const displayCount = vertexCount;
  const atMax = displayCount >= maxVertices;

  return (
    <div className="rounded border border-border-default overflow-hidden">
      {/* Control bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border-default flex-wrap">
        <span className="text-[10px] font-mono text-text-tertiary mr-1 flex items-center gap-1">
          <MapPin size={10} />
          {displayCount} / {maxVertices} vertices
          {atMax && !isDrawing && (
            <span className="text-status-warning ml-1">(max)</span>
          )}
        </span>

        {!isDrawing ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={startDraw}
          >
            Start draw
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={10} />}
              onClick={undoVertex}
              disabled={displayCount === 0}
            >
              Undo vertex
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Check size={10} />}
              disabled={displayCount < 3}
              onClick={() => {
                const manager = managerRef.current;
                if (manager) manager.completePolygon();
              }}
            >
              Finish
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<X size={10} />}
            onClick={cancelDraw}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Check size={10} />}
            disabled={!hasCommittable}
            onClick={commitToZone}
          >
            Commit to zone
          </Button>
        </div>
      </div>

      {/* Vertex count badge + empty state overlay */}
      <div className="relative">
        <div ref={mapContainerRef} style={{ height: 400 }} className="w-full" />

        {!isDrawing && displayCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-bg-secondary/80 rounded px-3 py-2 text-[11px] font-mono text-text-tertiary">
              No vertices yet. Click &ldquo;Start draw&rdquo; then click the map to add vertices.
            </div>
          </div>
        )}

        {isDrawing && (
          <div className="absolute top-2 left-2 pointer-events-none">
            <div className="bg-bg-secondary/90 rounded px-2 py-1 text-[10px] font-mono text-accent-primary">
              {displayCount} / {maxVertices}
            </div>
          </div>
        )}
      </div>

      {/* Instruction footer when drawing */}
      {isDrawing && (
        <div className="px-3 py-1.5 bg-bg-secondary border-t border-border-default text-[10px] font-mono text-text-tertiary">
          Click to add vertices. Double-click, right-click the first vertex or press Enter to close. Esc cancels the draw. Backspace removes the last vertex.
        </div>
      )}
    </div>
  );
}
