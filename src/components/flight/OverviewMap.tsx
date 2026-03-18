"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { Pause, Play, Ruler } from "lucide-react";
import { useDefaultCenter } from "@/hooks/use-default-center";
import {
  MapContainer,
  Circle,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import dynamic from "next/dynamic";
import { DrawingManager } from "@/lib/drawing/drawing-manager";

const GcsMarker = dynamic(
  () => import("@/components/map/GcsMarker").then((m) => ({ default: m.GcsMarker })),
  { ssr: false }
);
const TileLayerSwitcher = dynamic(
  () => import("@/components/map/TileLayerSwitcher").then((m) => ({ default: m.TileLayerSwitcher })),
  { ssr: false }
);
const MapContextMenu = dynamic(
  () => import("@/components/map/MapContextMenu").then((m) => ({ default: m.MapContextMenu })),
  { ssr: false }
);
const AltitudeTrail = dynamic(
  () => import("@/components/map/AltitudeTrail").then((m) => ({ default: m.AltitudeTrail })),
  { ssr: false }
);
const EditableGeofenceOverlay = dynamic(
  () => import("@/components/map/EditableGeofenceOverlay").then((m) => ({ default: m.EditableGeofenceOverlay })),
  { ssr: false }
);
const PlannedVsActualOverlay = dynamic(
  () => import("@/components/logs/PlannedVsActualOverlay").then((m) => ({ default: m.PlannedVsActualOverlay })),
  { ssr: false }
);
const LocateControl = dynamic(
  () => import("@/components/map/LocateControl").then((m) => ({ default: m.LocateControl })),
  { ssr: false }
);
const MissionExecutionOverlay = dynamic(
  () => import("@/components/flight/MissionExecutionOverlay").then((m) => ({ default: m.MissionExecutionOverlay })),
  { ssr: false }
);

// ── Drone marker colors per status ──────────────────────────

const STATUS_COLORS: Record<string, string> = {
  online: "#22c55e",
  in_mission: "#3a82ff",
  idle: "#a0a0a0",
  returning: "#f59e0b",
  maintenance: "#ef4444",
  offline: "#666666",
};

/** SVG arrow icon for the drone marker, rotated by heading. */
function createDroneIcon(heading: number, color = "#00ff41", size = 24): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${heading}deg)">
      <polygon points="12,2 20,20 12,16 4,20" fill="${color}" fill-opacity="0.9" stroke="${color}" stroke-width="1"/>
    </svg>`,
  });
}

/** Tells Leaflet to recalculate its size when the container resizes. */
function MapResizer() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

/** Auto-follows the drone position on the map. */
function MapFollower({ position, follow }: { position: [number, number] | null; follow: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (follow && position) {
      map.setView(position, map.getZoom(), { animate: true, duration: 0.3 });
    }
  }, [map, position, follow]);

  return null;
}

/** Manages the DrawingManager instance for measurement tool. */
function MeasureToolManager({ active, onComplete }: { active: boolean; onComplete: () => void }) {
  const map = useMap();
  const managerRef = useRef<DrawingManager | null>(null);

  useEffect(() => {
    if (!managerRef.current) {
      managerRef.current = new DrawingManager(map, {
        onCancel: onComplete,
      });
    }

    if (active) {
      managerRef.current.startMeasure();
    } else {
      managerRef.current.clearAll();
    }

    return () => {
      // Don't destroy on re-render, only on unmount
    };
  }, [map, active, onComplete]);

  useEffect(() => {
    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, [map]);

  return null;
}

export function OverviewMap() {
  const [follow, setFollow] = useState(true);
  const [showPlannedPath, setShowPlannedPath] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const mapReadyRef = useRef(false);

  // Mission pause/resume state
  const flightMode = useDroneStore((s) => s.flightMode);
  const previousMode = useDroneStore((s) => s.previousMode);
  const setFlightMode = useDroneStore((s) => s.setFlightMode);
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const missionState = useMissionStore((s) => s.activeMission?.state);
  const isAutoMode = flightMode === "AUTO";
  const isPausedFromAuto = flightMode === "LOITER" && previousMode === "AUTO";
  const showMissionControls = isAutoMode || isPausedFromAuto || missionState === "running" || missionState === "paused";

  // Subscribe to position updates
  const pos = useTelemetryStore((s) => s.position.latest());
  useTrailStore((s) => s._version); // subscribe to updates
  const trail = useTrailStore.getState()._ring.toArray();

  // Fleet drones for multi-drone markers
  const fleetDrones = useFleetStore((s) => s.drones);
  const profiles = useDroneMetadataStore((s) => s.profiles);

  const dronePos: [number, number] | null =
    pos && pos.lat !== 0 && pos.lon !== 0 ? [pos.lat, pos.lon] : null;

  const heading = pos?.heading ?? 0;
  const droneIcon = useMemo(() => createDroneIcon(heading, "#00ff41", 24), [heading]);

  // Home position = first trail point
  const homePos: [number, number] | null =
    trail.length > 0 ? [trail[0].lat, trail[0].lon] : null;

  const defaultCenter = useDefaultCenter();
  const hasGps = dronePos !== null;

  const handleMeasureComplete = useCallback(() => {
    setMeasureActive(false);
  }, []);

  // Other fleet drones (exclude the selected one to avoid double-render)
  const otherDrones = useMemo(
    () => fleetDrones.filter((d) => d.id !== selectedDroneId && d.position && d.position.lat !== 0),
    [fleetDrones, selectedDroneId]
  );

  return (
    <div className="relative w-full h-full border border-border-default overflow-hidden bg-[#0a0a0a] isolate">
      <span className="absolute top-2 left-2 z-[1000] text-[10px] font-mono text-text-secondary bg-bg-primary/80 backdrop-blur-md rounded px-1.5 py-0.5 border border-border-strong shadow-lg">
        Position
      </span>

      {/* No GPS overlay */}
      {!hasGps && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
          <span className="text-sm font-mono font-semibold text-text-secondary bg-bg-primary/90 backdrop-blur-md px-3 py-1.5 border border-border-strong rounded shadow-lg">
            NO GPS FIX
          </span>
        </div>
      )}

      <MapContainer
        center={dronePos ?? defaultCenter}
        zoom={17}
        className="w-full h-full"
        zoomControl={false}
        attributionControl={false}
        style={{ background: "#0a0a0a" }}
        whenReady={() => { mapReadyRef.current = true; }}
      >
        <TileLayerSwitcher />

        <MapResizer />
        <MapFollower position={dronePos} follow={follow} />
        <MapContextMenu />

        {/* Altitude-coded trail (falls back to blue when no alt data) */}
        <AltitudeTrail />

        {/* Interactive geofence editing */}
        <EditableGeofenceOverlay />

        {/* Planned vs actual path comparison */}
        {showPlannedPath && <PlannedVsActualOverlay />}

        {/* Home marker -- dashed blue circle */}
        {homePos && (
          <Circle
            center={homePos}
            radius={3}
            pathOptions={{
              color: "#3A82FF",
              weight: 1.5,
              dashArray: "4 4",
              fillColor: "#3A82FF",
              fillOpacity: 0.15,
            }}
          />
        )}

        {/* Selected drone marker (primary, larger) */}
        {dronePos && (
          <Marker position={dronePos} icon={droneIcon} />
        )}

        {/* Other fleet drone markers (smaller, status-colored) */}
        {otherDrones.map((drone) => {
          if (!drone.position) return null;
          const dColor = STATUS_COLORS[drone.status] ?? "#a0a0a0";
          const dHeading = drone.position.heading ?? 0;
          const icon = createDroneIcon(dHeading, dColor, 18);
          const displayName = profiles[drone.id]?.displayName ?? drone.name;
          return (
            <Marker
              key={drone.id}
              position={[drone.position.lat, drone.position.lon]}
              icon={icon}
            >
              <Popup>
                <div
                  className="text-xs font-mono"
                  style={{
                    color: "#fafafa",
                    background: "#0a0a0a",
                    padding: "4px 8px",
                    margin: "-8px -12px",
                  }}
                >
                  <strong>{displayName}</strong>
                  <br />
                  {drone.status}
                  {drone.battery?.remaining !== undefined && ` | ${Math.round(drone.battery.remaining)}%`}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Measurement tool */}
        <MeasureToolManager active={measureActive} onComplete={handleMeasureComplete} />

        <GcsMarker />
        <LocateControl style={{ marginBottom: 40 }} />
      </MapContainer>

      {/* Mission execution telemetry -- ETA + XTE */}
      <MissionExecutionOverlay />

      {/* Mission pause/resume overlay -- top right */}
      {showMissionControls && (
        <button
          onClick={() => {
            const protocol = getProtocol();
            if (isAutoMode) {
              if (protocol) protocol.pauseMission();
              else setFlightMode("LOITER");
            } else {
              if (protocol) protocol.resumeMission();
              else setFlightMode("AUTO");
            }
          }}
          className={`absolute top-2 right-2 z-[1000] flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono font-semibold border rounded backdrop-blur-md shadow-lg transition-colors ${
            isAutoMode
              ? "border-status-warning text-status-warning bg-status-warning/10 hover:bg-status-warning/20"
              : "border-status-success text-status-success bg-status-success/10 hover:bg-status-success/20"
          }`}
        >
          {isAutoMode ? <Pause size={12} /> : <Play size={12} />}
          {isAutoMode ? "PAUSE" : "RESUME"}
        </button>
      )}

      {/* Follow toggle + plan overlay + measure -- bottom right */}
      <div className="absolute bottom-2 right-2 z-[1000] flex items-center gap-1 bg-bg-primary/80 backdrop-blur-md rounded-lg p-1 shadow-lg border border-border-strong">
        <button
          onClick={() => {
            setMeasureActive((v) => !v);
          }}
          className={`text-[10px] font-mono px-2 py-1 transition-colors flex items-center gap-1 rounded ${
            measureActive
              ? "text-[#3A82FF] bg-[#3A82FF]/10"
              : "text-text-secondary hover:text-text-primary"
          }`}
          title="Measure distance and bearing (click points, double-click to finish)"
        >
          <Ruler size={10} />
          MEASURE
        </button>
        <button
          onClick={() => setShowPlannedPath((v) => !v)}
          className={`text-[10px] font-mono px-2 py-1 transition-colors rounded ${
            showPlannedPath
              ? "text-[#3A82FF] bg-[#3A82FF]/10"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          PLAN
        </button>
        <button
          onClick={() => setFollow((f) => !f)}
          className={`text-[10px] font-mono px-2 py-1 transition-colors rounded ${
            follow
              ? "text-[#3A82FF] bg-[#3A82FF]/10"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {follow ? "FOLLOW" : "FREE"}
        </button>
      </div>

      {/* Coordinates -- bottom left */}
      {dronePos && (
        <div className="absolute bottom-2 left-2 z-[1000] text-[10px] font-mono text-text-secondary bg-bg-primary/80 backdrop-blur-md px-2 py-1 border border-border-strong rounded shadow-lg">
          {dronePos[0].toFixed(6)}, {dronePos[1].toFixed(6)}
        </div>
      )}
    </div>
  );
}
