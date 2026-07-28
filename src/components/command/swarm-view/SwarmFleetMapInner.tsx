"use client";

/**
 * @module command/swarm-view/SwarmFleetMapInner
 * @description The fleet map's Leaflet body — client-only, never server rendered.
 *
 * This is the flight map's marker scaffolding with everything single-drone
 * stripped out: no altitude trail, no guidance vectors, no mission overlay, no
 * geofence editing, no measure tool. A command map carrying every overlay it
 * could carry is a map operators stop looking at, so this one draws exactly what
 * the table's columns already say — position, heading, severity — and nothing
 * the table does not.
 *
 * Marker colour comes from the theme's own status variables rather than the hex
 * table the flight map inlines: a `divIcon`'s HTML lives in the document, so
 * `var(--alt-status-error)` resolves there the same as anywhere else, and the
 * map follows the theme instead of pinning one.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { DEFAULT_CENTER } from "@/lib/map-constants";
import {
  SWARM_SEVERITY_ORDER,
  swarmHeadingDeg,
  type SwarmSeverity,
  type SwarmSlotRow,
} from "./swarm-rows";
import {
  isMarqueeDrag,
  marqueeBounds,
  marqueeSelection,
  type MarqueePoint,
  type MarqueeRect,
} from "./marquee";

/** Icon edge length in px. The marquee's containment test uses the same number. */
export const SWARM_ICON_SIZE = 22;

const SEVERITY_VAR: Record<SwarmSeverity, string> = {
  error: "var(--alt-status-error)",
  noBeacon: "var(--alt-text-tertiary)",
  offline: "var(--alt-text-tertiary)",
  warning: "var(--alt-status-warning)",
  armed: "var(--alt-status-success)",
  nominal: "var(--alt-accent-primary)",
};

/** The flight map's arrow, rotated by heading and tinted by severity. */
function createDroneIcon(
  heading: number,
  color: string,
  size: number,
  selected: boolean,
): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${heading}deg)">
      ${selected ? `<circle cx="12" cy="12" r="11" fill="none" stroke="var(--alt-accent-primary)" stroke-width="2"/>` : ""}
      <polygon points="12,2 20,20 12,16 4,20" fill="${color}" fill-opacity="0.9" stroke="${color}" stroke-width="1"/>
    </svg>`,
  });
}

/** Tells Leaflet to recalculate its size when the pane resizes. */
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Fits the view to the fleet once positions first arrive, then leaves it alone
 * — a map that re-centres under the operator's hand is a map they fight. */
function FitFleetOnce({ positions }: { positions: readonly [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || positions.length === 0) return;
    fitted.current = true;
    map.fitBounds(L.latLngBounds(positions.map((p) => L.latLng(p[0], p[1]))), {
      padding: [32, 32],
      maxZoom: 18,
    });
  }, [map, positions]);
  return null;
}

export interface SwarmFleetMapInnerProps {
  rows: readonly SwarmSlotRow[];
  selected: ReadonlySet<number>;
  onSelectSlots: (slots: readonly number[]) => void;
  /** While true, dragging draws a selection rectangle instead of panning. */
  selectMode: boolean;
}

export default function SwarmFleetMapInner({
  rows,
  selected,
  onSelectSlots,
  selectMode,
}: SwarmFleetMapInnerProps) {
  const positioned = useMemo(
    () => rows.filter((row) => row.beacon !== null),
    [rows],
  );
  const positions = useMemo(
    () =>
      positioned.map<[number, number]>((row) => [
        row.beacon?.lat ?? 0,
        row.beacon?.lon ?? 0,
      ]),
    [positioned],
  );

  return (
    <MapContainer
      center={positions[0] ?? DEFAULT_CENTER}
      zoom={17}
      style={{ width: "100%", height: "100%" }}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <MapResizer />
      <FitFleetOnce positions={positions} />

      {positioned.map((row) => {
        const beacon = row.beacon;
        if (!beacon) return null;
        return (
          <Marker
            key={row.slot}
            position={[beacon.lat, beacon.lon]}
            // Worst severity draws on top: an emergency must never be hidden
            // under a nominal drone that happens to be a metre north of it.
            zIndexOffset={
              1000 - SWARM_SEVERITY_ORDER.indexOf(row.severity) * 100
            }
            icon={createDroneIcon(
              swarmHeadingDeg(beacon),
              SEVERITY_VAR[row.severity],
              SWARM_ICON_SIZE,
              selected.has(row.slot),
            )}
            eventHandlers={{ click: () => onSelectSlots([row.slot]) }}
          />
        );
      })}

      <MarqueeLayer
        rows={positioned}
        active={selectMode}
        onSelectSlots={onSelectSlots}
      />
    </MapContainer>
  );
}

/**
 * The rubber band. Leaflet's own drag and box-zoom are suspended while the
 * select tool is active, so the gesture is unambiguous: one drag, one meaning.
 */
function MarqueeLayer({
  rows,
  active,
  onSelectSlots,
}: {
  rows: readonly SwarmSlotRow[];
  active: boolean;
  onSelectSlots: (slots: readonly number[]) => void;
}) {
  const map = useMap();
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  // The listeners are attached ONCE per select-mode change, and read the live
  // rows and callback through refs. Depending on them directly would tear the
  // subscription down and rebuild it on every pointermove — the drag re-renders
  // this component sixty times a second — which also means suspending and
  // resuming Leaflet's own dragging that often, mid-gesture.
  const rowsRef = useRef(rows);
  const selectRef = useRef(onSelectSlots);
  useEffect(() => {
    rowsRef.current = rows;
    selectRef.current = onSelectSlots;
  });

  const pointsNow = useCallback(
    (): MarqueePoint[] =>
      rowsRef.current.flatMap((row) => {
        const beacon = row.beacon;
        if (!beacon) return [];
        const point = map.latLngToContainerPoint([beacon.lat, beacon.lon]);
        return [{ slot: row.slot, x: point.x, y: point.y }];
      }),
    [map],
  );

  useEffect(() => {
    const container = map.getContainer();
    if (!active) {
      map.dragging.enable();
      map.boxZoom.enable();
      return;
    }
    map.dragging.disable();
    map.boxZoom.disable();

    const relative = (event: PointerEvent) => {
      const box = container.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const at = relative(event);
      start.current = at;
      setRect({ x1: at.x, y1: at.y, x2: at.x, y2: at.y });
      container.setPointerCapture(event.pointerId);
    };

    const onMove = (event: PointerEvent) => {
      const from = start.current;
      if (!from) return;
      const at = relative(event);
      setRect({ x1: from.x, y1: from.y, x2: at.x, y2: at.y });
    };

    const onUp = (event: PointerEvent) => {
      const from = start.current;
      start.current = null;
      setRect(null);
      if (!from) return;
      const at = relative(event);
      const dragged: MarqueeRect = { x1: from.x, y1: from.y, x2: at.x, y2: at.y };
      // A tap inside select mode clears the selection rather than selecting the
      // whole visible fleet, which is what a zero-area rectangle would do under
      // the crossing rule.
      selectRef.current(
        isMarqueeDrag(dragged)
          ? marqueeSelection(dragged, pointsNow(), SWARM_ICON_SIZE)
          : [],
      );
    };

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      map.dragging.enable();
      map.boxZoom.enable();
    };
  }, [map, active, pointsNow]);

  if (!rect) return null;

  const bounds = marqueeBounds(rect);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-[700] border-2 border-dashed border-accent-primary bg-accent-primary/10"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      }}
    />
  );
}
