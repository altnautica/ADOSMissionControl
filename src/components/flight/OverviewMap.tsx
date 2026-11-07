"use client";

import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import { useFreshTelemetry, useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { knownRemainingPct } from "@/lib/battery";
import { useDroneManager } from "@/stores/drone-manager";
import { useFleetDrones } from "@/stores/node-registry/use-fleet-drones";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { projectByBearing, GPS_FIX_LABELS } from "@/lib/drawing/geo-utils";
import { useGuidanceLine, useGuidancePathOptions } from "./use-guidance-line";
import { Pause, Play, Ruler } from "lucide-react";
import { useDefaultCenter } from "@/hooks/use-default-center";
import { DEFAULT_ZOOM_UNLOCATED } from "@/lib/map-constants";
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import dynamic from "next/dynamic";
import { buildSkillContext, activate } from "@/lib/skills";
import { MapFollower } from "@/components/map/MapFollower";
import { MeasureToolManager } from "@/components/map/MeasureToolManager";
import { FleetPluginSlot } from "@/components/plugins/FleetPluginSlot";
import { MissionRouteOverlay } from "@/components/flight/MissionRouteOverlay";
import { homeIcon } from "@/components/map/home-icon";

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
const PoiMarkerOverlay = dynamic(
  () => import("@/components/map/PoiMarkerOverlay").then((m) => ({ default: m.PoiMarkerOverlay })),
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
const GuidanceSettingsMenu = dynamic(
  () => import("@/components/shared/GuidanceSettingsMenu").then((m) => ({ default: m.GuidanceSettingsMenu })),
  { ssr: false }
);

// ── Drone marker colors per status ──────────────────────────

/** Marker fill per fleet status, as theme tokens (the icon is HTML, so the
 * colour is applied through a style attribute and resolves per theme). */
const STATUS_COLORS: Record<string, string> = {
  online: "var(--alt-status-success)",
  in_mission: "var(--alt-accent-primary)",
  idle: "var(--alt-text-secondary)",
  returning: "var(--alt-status-warning)",
  maintenance: "var(--alt-status-error)",
  offline: "var(--alt-text-tertiary)",
};
const STATUS_COLOR_UNKNOWN = STATUS_COLORS.idle;
const SELECTED_DRONE_COLOR = "var(--gcs-hud-green)";

/** Heading step the marker icons are cached at; finer turns are not visible. */
const ICON_HEADING_STEP_DEG = 5;
const droneIconCache = new Map<string, L.DivIcon>();

/**
 * SVG arrow icon for a drone marker, rotated by heading. Cached per heading
 * step, colour and size: a new icon object makes react-leaflet rebuild the
 * marker's DOM, which at telemetry rate across a fleet is the whole cost.
 * `color` is any CSS colour, including a `var(--token)`.
 */
function droneIcon(heading: number, color: string, size: number): L.DivIcon {
  const step = Math.round(heading / ICON_HEADING_STEP_DEG) * ICON_HEADING_STEP_DEG;
  const bucket = ((step % 360) + 360) % 360;
  const key = `${bucket}|${color}|${size}`;
  let icon = droneIconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${bucket}deg)">
      <polygon points="12,2 20,20 12,16 4,20" style="fill:${color};stroke:${color}" fill-opacity="0.9" stroke-width="1"/>
    </svg>`,
    });
    droneIconCache.set(key, icon);
  }
  return icon;
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

/**
 * The shared flight map. In `compact` mode (the cockpit minimap) it strips ALL
 * of its floating chrome — the GPS badge, the guidance settings menu, the
 * recenter control, the mission WP/ETA readout, the basemap-switcher badge, the
 * PAUSE button, the measure/plan/follow cluster and the coordinates readout —
 * leaving only the map imagery + drone marker + path, auto-follows the drone,
 * and goes non-interactive, so it reads as a clean game-like minimap. The full
 * Overview/Flight tab (default `compact=false`) keeps every control.
 *
 * `pluginOverlay` mounts the extension `map.overlay` slot over the map (the
 * same non-interactive layer the planner map carries), so an installed
 * extension's map layer shows in the cockpit minimap too. `children` are
 * extra Leaflet layers rendered inside the map (the minimap's follow target).
 */
export function OverviewMap({
  compact = false,
  pluginOverlay = false,
  children,
}: { compact?: boolean; pluginOverlay?: boolean; children?: ReactNode } = {}) {
  const [follow, setFollow] = useState(true);
  const [showPlannedPath, setShowPlannedPath] = useState(false);
  const [measureActive, setMeasureActive] = useState(false);
  const mapReadyRef = useRef(false);

  // Mission pause/resume state
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  // mission state, never inferred from flight-mode names.
  const missionState = useMissionStatus(selectedDroneId)?.state ?? null;
  const isAutoMode = missionState === "active";
  const showMissionControls = missionState === "active" || missionState === "paused";

  // Position, GPS and navigation output only while fresh: the rings keep the
  // last sample after the link dies, and a frozen fix must not read as live.
  const pos = useFreshTelemetry("position");
  const gps = useFreshTelemetry("gps");
  const nav = useFreshTelemetry("navController");
  // Something was received but none of it is current: the link went quiet.
  const lastPos = useTelemetryLatest("position");
  const positionStale = pos === undefined && lastPos !== undefined;
  // HOME_POSITION is latched state (sent rarely, changes only on arm or
  // set-home), so it is read without an age gate; the ring is cleared on
  // selection change and disconnect.
  const home = useTelemetryLatest("homePosition");

  // Guidance line settings
  const hdgGuide = useGuidanceLine("hdg");
  const trackWpGuide = useGuidanceLine("trackWp");
  const tgtHdgGuide = useGuidanceLine("tgtHdg");
  const hdgPathOptions = useGuidancePathOptions(hdgGuide);
  const trackWpPathOptions = useGuidancePathOptions(trackWpGuide);
  const tgtHdgPathOptions = useGuidancePathOptions(tgtHdgGuide);

  // Fleet drones for multi-drone markers
  const fleetDrones = useFleetDrones();
  const profiles = useDroneMetadataStore((s) => s.profiles);

  const lat = pos && pos.lat !== 0 && pos.lon !== 0 ? pos.lat : null;
  const lon = lat !== null && pos ? pos.lon : null;
  // One tuple per actual move, so the follower and the marker see a stable
  // reference while the drone holds still.
  const dronePos = useMemo<[number, number] | null>(
    () => (lat !== null && lon !== null ? [lat, lon] : null),
    [lat, lon],
  );

  const heading = pos?.heading ?? 0;
  const headingDeg = Math.round(heading);
  const selectedIcon = useMemo(() => droneIcon(headingDeg, SELECTED_DRONE_COLOR, 24), [headingDeg]);

  // The FC's own home, the point RTL returns to. Hidden until one arrives: the
  // oldest trail point is not home, it walks along the track once the trail
  // ring fills and restarts wherever this GCS first saw the drone.
  const homeLat = home?.lat;
  const homeLon = home?.lon;
  const homePos = useMemo<[number, number] | null>(
    () => (homeLat !== undefined && homeLon !== undefined ? [homeLat, homeLon] : null),
    [homeLat, homeLon],
  );

  const defaultCenter = useDefaultCenter();
  const hasGps = dronePos !== null;

  const handleMeasureComplete = useCallback(() => {
    setMeasureActive(false);
  }, []);

  // GPS status display: unknown until a fresh GPS report says otherwise.
  const fixType = gps?.fixType;
  const satellites = gps?.satellites;
  const fixLabel = fixType === undefined ? "--" : (GPS_FIX_LABELS[fixType] ?? `FIX ${fixType}`);
  const fixColor =
    fixType === undefined
      ? "text-text-tertiary"
      : fixType >= 3
        ? "text-status-success"
        : fixType >= 2
          ? "text-status-warning"
          : "text-status-error";

  // Guidance vector endpoints
  const hdgLength = hdgGuide.length;
  const hdgLine = useMemo(() => {
    if (!dronePos) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], heading, hdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, heading, hdgLength]);

  const trackWpLength = trackWpGuide.length;
  const trackWpLine = useMemo(() => {
    if (!dronePos || !nav) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], nav.targetBearing, trackWpLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, nav, trackWpLength]);

  const tgtHdgLength = tgtHdgGuide.length;
  const tgtHdgLine = useMemo(() => {
    if (!dronePos || !nav) return null;
    const end = projectByBearing(dronePos[0], dronePos[1], nav.navBearing, tgtHdgLength);
    return [dronePos, end] as [[number, number], [number, number]];
  }, [dronePos, nav, tgtHdgLength]);

  // Other fleet drones (exclude the selected one to avoid double-render)
  const otherDrones = useMemo(
    () => fleetDrones.filter((d) => d.id !== selectedDroneId && d.position && d.position.lat !== 0),
    [fleetDrones, selectedDroneId]
  );

  return (
    <div className="relative w-full h-full border border-border-default overflow-hidden bg-bg-secondary isolate">
      {!compact && (
        <>
          <span className={`absolute top-2 left-2 z-[1000] text-[10px] font-mono bg-bg-primary/80 backdrop-blur-md rounded px-1.5 py-0.5 border border-border-strong shadow-lg ${fixColor}`}>
            {fixLabel} | {satellites ?? "--"} SAT
          </span>

          <GuidanceSettingsMenu />

          {/* No live position overlay */}
          {!hasGps && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
              <span className="text-sm font-mono font-semibold text-text-secondary bg-bg-primary/90 backdrop-blur-md px-3 py-1.5 border border-border-strong rounded shadow-lg">
                {positionStale ? "POSITION STALE" : "NO GPS FIX"}
              </span>
            </div>
          )}
        </>
      )}

      <MapContainer
        center={dronePos ?? defaultCenter.center}
        zoom={dronePos ? 17 : defaultCenter.located ? 15 : DEFAULT_ZOOM_UNLOCATED}
        className="w-full h-full"
        zoomControl={false}
        dragging={!compact}
        scrollWheelZoom={!compact}
        doubleClickZoom={!compact}
        touchZoom={!compact}
        boxZoom={!compact}
        keyboard={!compact}
        style={{ background: "var(--alt-bg-secondary)" }}
        whenReady={() => { mapReadyRef.current = true; }}
      >
        <TileLayerSwitcher showControls={!compact} />

        <MapResizer />
        <MapFollower position={dronePos} follow={compact ? true : follow} />
        <MapContextMenu />

        {/* Altitude-coded trail (falls back to blue when no alt data) */}
        <AltitudeTrail />

        {/* Interactive geofence editing */}
        <EditableGeofenceOverlay />

        {/* The mission the aircraft is flying + the waypoint it is heading to */}
        <MissionRouteOverlay />

        {/* Planned vs actual path comparison */}
        {showPlannedPath && <PlannedVsActualOverlay />}

        {/* Home marker -- SVG icon */}
        {homePos && (
          <Marker position={homePos} icon={homeIcon} interactive={false} />
        )}

        {/* Guidance vector polylines */}
        {hdgGuide.enabled && hdgLine && (
          <Polyline positions={hdgLine} pathOptions={hdgPathOptions} />
        )}
        {trackWpGuide.enabled && trackWpLine && (
          <Polyline positions={trackWpLine} pathOptions={trackWpPathOptions} />
        )}
        {tgtHdgGuide.enabled && tgtHdgLine && (
          <Polyline positions={tgtHdgLine} pathOptions={tgtHdgPathOptions} />
        )}

        {/* Selected drone marker (primary, larger) */}
        {dronePos && (
          <Marker position={dronePos} icon={selectedIcon} />
        )}

        {/* Other fleet drone markers (smaller, status-colored) */}
        {otherDrones.map((drone) => {
          if (!drone.position) return null;
          const dColor = STATUS_COLORS[drone.status] ?? STATUS_COLOR_UNKNOWN;
          const icon = droneIcon(drone.position.heading ?? 0, dColor, 18);
          const remaining = knownRemainingPct(drone.battery?.remaining);
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
                    color: "var(--alt-text-primary)",
                    background: "var(--alt-bg-secondary)",
                    padding: "4px 8px",
                    margin: "-8px -12px",
                  }}
                >
                  <strong>{displayName}</strong>
                  <br />
                  {drone.status}
                  {remaining !== null && ` | ${Math.round(remaining)}%`}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Measurement tool */}
        <MeasureToolManager active={measureActive} onComplete={handleMeasureComplete} />

        <PoiMarkerOverlay />
        <GcsMarker />
        {children}
        {!compact && <LocateControl style={{ marginBottom: 40 }} />}
      </MapContainer>

      {pluginOverlay && (
        <div
          data-map-layer="plugin-map-overlay"
          className="absolute inset-0 z-[900] pointer-events-none"
        >
          <FleetPluginSlot
            name="map.overlay"
            className="absolute inset-0"
            iframeClassName="absolute inset-0 w-full h-full border-0"
          />
        </div>
      )}

      {/* Mission execution telemetry -- ETA + XTE (full map only) */}
      {!compact && <MissionExecutionOverlay />}

      {/* Guided mode: confirmation dialog + target overlay (interactive map only) */}
      {!compact && (
        <>
          <GuidedConfirmDialog />
          <GuidedTargetOverlay />
        </>
      )}

      {/* Mission pause/resume overlay -- top right */}
      {!compact && showMissionControls && (
        <button
          onClick={() => {
            if (!selectedDroneId) return;
            // Through the dispatcher, like every other flight action. The old
            // no-protocol branch wrote LOITER/AUTO into the local drone store,
            // so the mode label moved for a command nothing transmitted.
            void activate(
              isAutoMode ? "pause" : "resume",
              buildSkillContext(selectedDroneId),
            );
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
      {!compact && (
      <div className="absolute bottom-2 right-2 z-[1000] flex items-center gap-1 bg-bg-primary/80 backdrop-blur-md rounded-lg p-1 shadow-lg border border-border-strong">
        <button
          onClick={() => {
            setMeasureActive((v) => !v);
          }}
          className={`text-[10px] font-mono px-2 py-1 transition-colors flex items-center gap-1 rounded ${
            measureActive
              ? "text-accent-primary bg-accent-primary/10"
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
              ? "text-accent-primary bg-accent-primary/10"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          PLAN
        </button>
        <button
          onClick={() => setFollow((f) => !f)}
          className={`text-[10px] font-mono px-2 py-1 transition-colors rounded ${
            follow
              ? "text-accent-primary bg-accent-primary/10"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {follow ? "FOLLOW" : "FREE"}
        </button>
      </div>
      )}

      {/* Coordinates -- bottom left */}
      {!compact && dronePos && (
        <div className="absolute bottom-2 left-2 z-[1000] text-[10px] font-mono text-text-secondary bg-bg-primary/80 backdrop-blur-md px-2 py-1 border border-border-strong rounded shadow-lg">
          {dronePos[0].toFixed(6)}, {dronePos[1].toFixed(6)}
        </div>
      )}
    </div>
  );
}
