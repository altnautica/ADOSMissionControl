"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useTrailStore } from "@/stores/trail-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Pause, Play, Ruler } from "lucide-react";
import { useDefaultCenter } from "@/hooks/use-default-center";
import {
  MapContainer,
  Circle,
  Marker,
  Polyline,
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
const GuidanceSettingsMenu = dynamic(
  () => import("@/components/shared/GuidanceSettingsMenu").then((m) => ({ default: m.GuidanceSettingsMenu })),
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
const GuidedConfirmDialog = dynamic(
  () => import("@/components/flight/GuidedConfirmDialog").then((m) => ({ default: m.GuidedConfirmDialog })),
  { ssr: false }
);
const GuidedTargetOverlay = dynamic(
  () => import("@/components/flight/GuidedTargetOverlay").then((m) => ({ default: m.GuidedTargetOverlay })),
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

/** Convert line type setting to Leaflet dashArray value. */
function getLineTypeDashArray(lineType: "solid" | "dashed" | "dotted"): string | undefined {
  switch (lineType) {
    case "solid":
      return undefined;
    case "dashed":
      return "6 4";
    case "dotted":
      return "2 2";
    default:
      return undefined;
  }
}

/** Project a lat/lon by distance (m) at a given bearing (deg). */
function projectByBearing(lat: number, lon: number, bearingDeg: number, distanceM: number): [number, number] {
  const R = 6371000;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const dByR = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(dByR) +
    Math.cos(lat1) * Math.sin(dByR) * Math.cos(brng),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(dByR) * Math.cos(lat1),
    Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2),
  );

  return [(lat2 * 180) / Math.PI, ((lon2 * 180) / Math.PI + 540) % 360 - 180];
}

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
  const pos = useTelemetryLatest("position");
  const gps = useTelemetryLatest("gps");
  const nav = useTelemetryLatest("navController");
  useTrailStore((s) => s._version); // subscribe to updates
  const trail = useTrailStore.getState()._ring.toArray();
  const missionWaypoints = useMissionStore((s) => s.waypoints);
  const currentWaypoint = useMissionStore((s) => s.currentWaypoint);

  // Fleet drones for multi-drone markers
  const fleetDrones = useFleetStore((s) => s.drones);
  const profiles = useDroneMetadataStore((s) => s.profiles);

  const dronePos: [number, number] | null =
    pos && pos.lat !== 0 && pos.lon !== 0 ? [pos.lat, pos.lon] : null;

  // Guidance settings (must be before their use in memos)
  const guidanceHdgLength = useSettingsStore((s) => s.guidanceHdgLength);
  const guidanceHdgWidth = useSettingsStore((s) => s.guidanceHdgWidth);
  const guidanceHdgLineType = useSettingsStore((s) => s.guidanceHdgLineType);
  const guidanceHdgColor = useSettingsStore((s) => s.guidanceHdgColor);

  const guidanceTrackWpLength = useSettingsStore((s) => s.guidanceTrackWpLength);
  const guidanceTrackWpWidth = useSettingsStore((s) => s.guidanceTrackWpWidth);
  const guidanceTrackWpLineType = useSettingsStore((s) => s.guidanceTrackWpLineType);
  const guidanceTrackWpColor = useSettingsStore((s) => s.guidanceTrackWpColor);

  const guidanceTgtHdgLength = useSettingsStore((s) => s.guidanceTgtHdgLength);
  const guidanceTgtHdgWidth = useSettingsStore((s) => s.guidanceTgtHdgWidth);
  const guidanceTgtHdgLineType = useSettingsStore((s) => s.guidanceTgtHdgLineType);
  const guidanceTgtHdgColor = useSettingsStore((s) => s.guidanceTgtHdgColor);

  const heading = pos?.heading ?? 0;
  const droneIcon = useMemo(() => createDroneIcon(heading, "#00ff41", 24), [heading]);

  // 1. CURRENT HEADING (RED/ORANGE) — Drone's physical pointing direction
  // The direction the drone is physically facing (yaw orientation)
  // Based on compass/magnetometer data
  // Shows which way the nose of the aircraft is pointing
  const currentHeadingVector = useMemo(() => {
    if (!dronePos || !Number.isFinite(heading)) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], heading, guidanceHdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, heading, guidanceHdgLength]);

  // 3. TARGET HEADING (GREEN) — Autopilot desired heading
  // The direction the autopilot wants the drone to face
  // May differ from current heading during turns or course corrections
  // In autonomous modes, this aligns with the desired flight path
  const targetHeading = nav?.targetBearing;
  const targetHeadingVector = useMemo(() => {
    if (!dronePos || targetHeading === undefined || !Number.isFinite(targetHeading)) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], targetHeading, guidanceTgtHdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, targetHeading, guidanceTgtHdgLength]);

  // 2. DIRECT TO CURRENT WAYPOINT (ORANGE/YELLOW) — Shortest path to active waypoint
  // The direct line/bearing from drone's current position to the active waypoint
  // Shows the shortest path to the next waypoint
  // Helps you see if the drone is on the optimal route
  const wpIndex = currentWaypoint > 0 ? currentWaypoint - 1 : -1;
  const currentWp = wpIndex >= 0 && wpIndex < missionWaypoints.length ? missionWaypoints[wpIndex] : null;
  const trackToWpLine = useMemo(() => {
    if (!dronePos || !currentWp) return null;
    return [dronePos, [currentWp.lat, currentWp.lon] as [number, number]] as [[number, number], [number, number]];
  }, [dronePos, currentWp]);

  const homeTelemetry = useTelemetryStore((s) => s.homePosition.latest());
  // Home position source priority: FC HOME_POSITION -> legacy trail start
  const homePos: [number, number] | null = useMemo(() => {
    if (homeTelemetry && homeTelemetry.lat !== 0 && homeTelemetry.lon !== 0) {
      return [homeTelemetry.lat, homeTelemetry.lon];
    }
    if (trail.length > 0) return [trail[0].lat, trail[0].lon];
    return null;
  }, [homeTelemetry, trail]);

  const homeIcon = useMemo(() => {
    return L.divIcon({
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html: `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="8" fill="rgba(58,130,255,0.18)" stroke="#3a82ff" stroke-width="1.4" stroke-dasharray="3 2"/>
        <circle cx="10" cy="10" r="2.5" fill="#3a82ff"/>
      </svg>`,
    });
  }, []);

  const defaultCenter = useDefaultCenter();
  const hasGps = dronePos !== null;

  const gpsFixLabel = useMemo(() => {
    switch (gps?.fixType ?? 0) {
      case 0:
      case 1:
        return "No Fix";
      case 2:
        return "2D Fix";
      case 3:
        return "3D Fix";
      case 4:
        return "DGPS";
      case 5:
        return "RTK Float";
      case 6:
        return "RTK Fixed";
      default:
        return `Fix ${gps?.fixType}`;
    }
  }, [gps]);

  const gpsStatusTone = hasGps
    ? "border-status-success/40 text-status-success"
    : gps?.fixType && gps.fixType >= 2
      ? "border-status-warning/40 text-status-warning"
      : "border-border-strong text-text-secondary";

  const gpsStatusLabel = hasGps
    ? "GPS LIVE"
    : gps?.fixType && gps.fixType >= 2
      ? "GETTING POSITION"
      : "ACQUIRING GPS";

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
      <div className={`absolute top-3 left-3 z-[1000] bg-bg-primary/80 backdrop-blur-md rounded px-2 py-1 border shadow-lg ${gpsStatusTone}`}>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="font-semibold">{gpsStatusLabel}</span>
          <span className="text-text-tertiary">|</span>
          <span>{gpsFixLabel}</span>
          <span className="text-text-tertiary">|</span>
          <span>{gps?.satellites ?? 0} sats</span>
        </div>
      </div>

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
          <>
            <Circle
              center={homePos}
              radius={6}
              pathOptions={{
                color: "#3A82FF",
                weight: 1.5,
                dashArray: "4 4",
                fillColor: "#3A82FF",
                fillOpacity: 0.15,
              }}
            />
            <Marker position={homePos} icon={homeIcon} interactive={false} />
          </>
        )}

        {/* Selected drone marker (primary, larger) */}
        {dronePos && (
          <Marker position={dronePos} icon={droneIcon} />
        )}

        {/* Current heading vector (nose direction) */}
        {currentHeadingVector && (
          <Polyline
            positions={currentHeadingVector}
            pathOptions={{
              color: guidanceHdgColor,
              weight: guidanceHdgWidth,
              opacity: 0.9,
              dashArray: getLineTypeDashArray(guidanceHdgLineType),
            }}
          />
        )}

        {/* GPS track to active mission waypoint */}
        {trackToWpLine && (
          <Polyline
            positions={trackToWpLine}
            pathOptions={{
              color: guidanceTrackWpColor,
              weight: guidanceTrackWpWidth,
              opacity: 0.85,
              dashArray: getLineTypeDashArray(guidanceTrackWpLineType),
            }}
          />
        )}

        {/* Target heading vector from NAV_CONTROLLER_OUTPUT */}
        {targetHeadingVector && (
          <Polyline
            positions={targetHeadingVector}
            pathOptions={{
              color: guidanceTgtHdgColor,
              weight: guidanceTgtHdgWidth,
              opacity: 0.9,
              dashArray: getLineTypeDashArray(guidanceTgtHdgLineType),
            }}
          />
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

      {/* Guided mode: confirmation dialog + target overlay */}
      <GuidedConfirmDialog />
      <GuidedTargetOverlay />

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

      {/* Guidance vectors legend with settings menu */}
      <GuidanceSettingsMenu />
    </div>
  );
}
