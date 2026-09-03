/**
 * @module GeozoneZoneEditor
 * @description Editor for a single iNav geozone (header row + expanded form).
 * Sub-component of GeozonePanel; renders type/shape/altitude/fence-action
 * controls plus a vertex list with optional embedded map editor.
 * @license GPL-3.0-only
 */

"use client";

import { useGeozoneStore, GEOZONE_SHAPE, GEOZONE_TYPE } from "@/stores/geozone-store";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { GeozoneMapEditor } from "./GeozoneMapEditor";
import type { INavGeozoneVertex } from "@/lib/protocol/msp/msp-decoders-inav";
import { Plus, Trash2, ChevronDown, ChevronRight, Map } from "lucide-react";
import { cn } from "@/lib/utils";

const ZONE_TYPE_OPTIONS = [
  { value: String(GEOZONE_TYPE.EXCLUSIVE), label: "Exclusive (no-fly)" },
  { value: String(GEOZONE_TYPE.INCLUSIVE), label: "Inclusive (must stay inside)" },
];

const ZONE_SHAPE_OPTIONS = [
  { value: String(GEOZONE_SHAPE.POLYGON), label: "Polygon" },
  { value: String(GEOZONE_SHAPE.CIRCULAR), label: "Circular" },
];

const FENCE_ACTION_OPTIONS = [
  { value: "0", label: "0 : None" },
  { value: "1", label: "1 : Avoid" },
  { value: "2", label: "2 : RTH on breach" },
  { value: "3", label: "3 : Poshold indefinite" },
  { value: "4", label: "4 : Poshold timed" },
];

const formatCoord = (val: number) => val.toFixed(7);

interface ZoneRow {
  number: number;
  type: number;
  shape: number;
  minAlt: number;
  maxAlt: number;
  fenceAction: number;
  isSeaLevelRef: boolean;
}

interface GeozoneZoneEditorProps {
  zone: ZoneRow;
  zoneVerts: INavGeozoneVertex[];
  isActive: boolean;
  mapEditZoneId: number | null;
  onToggleActive: () => void;
  onSetMapEditZoneId: (id: number | null) => void;
}

export function GeozoneZoneEditor({
  zone,
  zoneVerts,
  isActive,
  mapEditZoneId,
  onToggleActive,
  onSetMapEditZoneId,
}: GeozoneZoneEditorProps) {
  const updateZone = useGeozoneStore((s) => s.updateZone);
  const removeZone = useGeozoneStore((s) => s.removeZone);
  const addVertex = useGeozoneStore((s) => s.addVertex);
  const removeVertex = useGeozoneStore((s) => s.removeVertex);
  const updateVertex = useGeozoneStore((s) => s.updateVertex);
  const replaceVertices = useGeozoneStore((s) => s.replaceVertices);

  const isPolygon = zone.shape === GEOZONE_SHAPE.POLYGON;

  return (
    <div
      className={cn(
        "border border-border-default rounded",
        isActive && "border-accent-primary",
      )}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={onToggleActive}
      >
        {isActive ? (
          <ChevronDown size={12} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-text-tertiary shrink-0" />
        )}
        <span className="text-[10px] font-mono text-text-tertiary w-4">{zone.number}</span>
        <span
          className={cn(
            "text-[10px] font-mono px-1.5 py-0.5 rounded",
            zone.type === GEOZONE_TYPE.EXCLUSIVE
              ? "bg-status-error/15 text-status-error"
              : "bg-status-success/15 text-status-success",
          )}
        >
          {zone.type === GEOZONE_TYPE.EXCLUSIVE ? "EXCL" : "INCL"}
        </span>
        <span className="text-[10px] font-mono text-text-secondary">
          {isPolygon ? `Polygon ${zoneVerts.length}pts` : "Circle"}
        </span>
        <span className="text-[10px] font-mono text-text-tertiary ml-auto">
          {zone.minAlt / 100}m to {zone.maxAlt / 100}m
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeZone(zone.number);
          }}
          className="p-1 text-text-tertiary hover:text-status-error transition-colors"
          aria-label="Remove zone"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {isPolygon && zoneVerts.length < 3 && (
        <p className="px-3 pb-1 text-[10px] font-mono text-status-warning">
          Polygon zones need at least 3 vertices before upload.
        </p>
      )}

      {isActive && (
        <div
          className="px-3 pb-4 pt-2 border-t border-border-default space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Type"
              options={ZONE_TYPE_OPTIONS}
              value={String(zone.type)}
              onChange={(v) => updateZone(zone.number, { type: Number(v) as 0 | 1 })}
            />
            <Select
              label="Shape"
              options={ZONE_SHAPE_OPTIONS}
              value={String(zone.shape)}
              onChange={(v) => updateZone(zone.number, { shape: Number(v) as 0 | 1 })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-text-tertiary font-mono">Min altitude (m)</span>
              <input
                type="number"
                step="1"
                value={zone.minAlt / 100}
                onChange={(e) =>
                  updateZone(zone.number, {
                    minAlt: Math.round((parseFloat(e.target.value) || 0) * 100),
                  })
                }
                className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-text-tertiary font-mono">Max altitude (m)</span>
              <input
                type="number"
                step="1"
                value={zone.maxAlt / 100}
                onChange={(e) =>
                  updateZone(zone.number, {
                    maxAlt: Math.round((parseFloat(e.target.value) || 0) * 100),
                  })
                }
                className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
              />
            </label>
          </div>

          <Select
            label="Fence action"
            options={FENCE_ACTION_OPTIONS}
            value={String(zone.fenceAction)}
            onChange={(v) => updateZone(zone.number, { fenceAction: Number(v) })}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                updateZone(zone.number, { isSeaLevelRef: !zone.isSeaLevelRef })
              }
              className={cn(
                "w-8 h-4 rounded-full relative transition-colors shrink-0",
                zone.isSeaLevelRef
                  ? "bg-accent-primary"
                  : "bg-bg-tertiary border border-border-default",
              )}
            >
              <div
                className={cn(
                  "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                  zone.isSeaLevelRef ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
            <span className="text-[10px] text-text-secondary font-mono">
              Altitudes relative to sea level
            </span>
          </div>

          {isPolygon && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider">
                  Vertices ({zoneVerts.length})
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Map size={10} />}
                    onClick={() =>
                      onSetMapEditZoneId(
                        mapEditZoneId === zone.number ? null : zone.number,
                      )
                    }
                  >
                    {mapEditZoneId === zone.number ? "Hide map" : "Draw on map"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus size={10} />}
                    onClick={() => addVertex(zone.number, { lat: 0, lon: 0 })}
                  >
                    Add vertex
                  </Button>
                </div>
              </div>

              {mapEditZoneId === zone.number && (
                <GeozoneMapEditor
                  zoneId={zone.number}
                  shape={zone.shape}
                  currentVertices={zoneVerts}
                  maxVertices={10}
                  onCommit={(verts: INavGeozoneVertex[]) => {
                    replaceVertices(zone.number, verts);
                    onSetMapEditZoneId(null);
                  }}
                  onCancel={() => onSetMapEditZoneId(null)}
                />
              )}

              {zoneVerts.map((vert) => (
                <div key={vert.vertexIdx} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-tertiary w-4 shrink-0">
                    {vert.vertexIdx}
                  </span>
                  <input
                    type="number"
                    step="0.0000001"
                    value={formatCoord(vert.lat)}
                    onChange={(e) =>
                      updateVertex(
                        zone.number,
                        vert.vertexIdx,
                        parseFloat(e.target.value) || 0,
                        vert.lon,
                      )
                    }
                    placeholder="Lat"
                    className="flex-1 bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                  />
                  <input
                    type="number"
                    step="0.0000001"
                    value={formatCoord(vert.lon)}
                    onChange={(e) =>
                      updateVertex(
                        zone.number,
                        vert.vertexIdx,
                        vert.lat,
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    placeholder="Lon"
                    className="flex-1 bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                  />
                  <button
                    onClick={() => removeVertex(zone.number, vert.vertexIdx)}
                    className="p-1 text-text-tertiary hover:text-status-error transition-colors shrink-0"
                    aria-label="Remove vertex"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!isPolygon && (
            <p className="text-[10px] text-text-tertiary font-mono">
              Circular zones use param1 on the waypoint as radius. Set via the mission planner.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
