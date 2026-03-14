/**
 * @module AirTrafficViewer
 * @description Composition root for the Air Traffic 3D view.
 * Renders CesiumJS globe with airspace zones, live aircraft, drone position,
 * and all control panels/overlays. Manages traffic polling lifecycle and
 * flyability assessment on globe click.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useState, useCallback, useRef, Component, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Cartesian3, Cartographic, ScreenSpaceEventHandler, ScreenSpaceEventType, Math as CesiumMath, defined, type Viewer as CesiumViewer } from "cesium";
import dynamic from "next/dynamic";
import { useAirspaceStore } from "@/stores/airspace-store";
import { useTrafficStore } from "@/stores/traffic-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { communityApi } from "@/lib/community-api";
import { fetchAircraft, fetchFromConvexCache } from "@/lib/airspace/adsb-provider";
import { loadAllAirspaceZones } from "@/lib/airspace/airspace-provider";
import { fetchNotams } from "@/lib/airspace/notam-provider";
import { computeAllThreats } from "@/lib/airspace/threat-calculator";
import { assessFlyability } from "@/lib/airspace/flyability";
import { lookupJurisdiction } from "@/lib/airspace/jurisdiction-lookup";
import { randomId } from "@/lib/utils";
import type { AircraftState, ThreatLevel, TrafficAlert } from "@/lib/airspace/types";

import { AirspaceVolumeEntities } from "./entities/AirspaceVolumeEntities";
import { AircraftEntities } from "./entities/AircraftEntities";
import { DronePositionEntity } from "./entities/DronePositionEntity";
import { NotamEntities } from "./entities/NotamEntities";
import { ZoneBoundaryEntities } from "./entities/ZoneBoundaryEntities";
import { AirportEntities } from "./entities/AirportEntities";
import { LayerControlPanel } from "./panels/LayerControlPanel";
import { AirspaceInfoPanel } from "./panels/AirspaceInfoPanel";
import { AlertsPanel } from "./panels/AlertsPanel";
import { LocationSearchPanel } from "./panels/LocationSearchPanel";
import { FlyabilityOverlay } from "./overlays/FlyabilityOverlay";
import { TimelineScrubber } from "./overlays/TimelineScrubber";
import { AirTrafficMapControls } from "./controls/AirTrafficMapControls";
import { AirTrafficToolbar } from "./controls/AirTrafficToolbar";
import { StatsOverlay } from "./overlays/StatsOverlay";
import { AltitudeSlider } from "./overlays/AltitudeSlider";
import { AirportDetailPanel } from "./panels/AirportDetailPanel";
import { FlightSearchPanel } from "./panels/FlightSearchPanel";
import { AircraftDetailPanel } from "./panels/AircraftDetailPanel";
import { FlightTrailEntities } from "./entities/FlightTrailEntities";
import { ConnectionBanner } from "./overlays/ConnectionBanner";
import { useViewportAwareness } from "@/hooks/use-viewport-awareness";

const CesiumScene = dynamic(
  () => import("@/components/simulation/CesiumScene"),
  { ssr: false }
);

/** Fetches Cesium Ion token from Convex. */
function ConvexCesiumToken({ onToken }: { onToken: (token: string | null) => void }) {
  const config = useQuery(communityApi.clientConfig.get, {});
  useEffect(() => {
    if (config !== undefined) {
      onToken((config as { cesiumIonToken?: string } | null)?.cesiumIonToken ?? null);
    }
  }, [config, onToken]);
  return null;
}

/** Fetches OpenAIP API key from Convex. */
function ConvexOpenAIPKey({ onKey }: { onKey: (key: string | null) => void }) {
  const config = useQuery(communityApi.clientConfig.get, {});
  useEffect(() => {
    if (config !== undefined) {
      onKey((config as { openAipApiKey?: string } | null)?.openAipApiKey ?? null);
    }
  }, [config, onKey]);
  return null;
}

/** Subscribes to Convex ADS-B cache and forwards aircraft data via callback. */
function ConvexAdsbCache({ onData }: { onData: (data: { aircraft: any[]; source: string; fetchedAt: number }) => void }) {
  const data = useQuery(communityApi.adsbCache.getAll, {});
  useEffect(() => {
    if (data !== undefined) {
      onData(data as { aircraft: any[]; source: string; fetchedAt: number });
    }
  }, [data, onData]);
  return null;
}

/** Error boundary that silently catches Convex query errors. */
class ConvexErrorBoundary extends Component<{ children: ReactNode; onError?: () => void }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() { return this.state.hasError ? null : this.props.children; }
}

// ── Alert deduplication ──────────────────────────────────────────────

const ALERT_COOLDOWN_MS = 30_000;

export function AirTrafficViewer() {
  const [viewer, setViewer] = useState<CesiumViewer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const convexAvailable = useConvexAvailable();
  const [cesiumToken, setCesiumToken] = useState<string | undefined>(undefined);
  const handleCesiumToken = useCallback((t: string | null) => {
    setCesiumToken(t ?? undefined);
  }, []);
  const [openAipKey, setOpenAipKey] = useState<string | null>(null);
  const handleOpenAIPKey = useCallback((k: string | null) => setOpenAipKey(k), []);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAlertRef = useRef<Map<string, number>>(new Map());

  // Settings
  const cesiumImageryMode = useSettingsStore((s) => s.cesiumImageryMode);
  const cesiumBuildingsEnabled = useSettingsStore((s) => s.cesiumBuildingsEnabled);
  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
  const jurisdiction = useSettingsStore((s) => s.jurisdiction);

  // Store actions
  const setZones = useAirspaceStore((s) => s.setZones);
  const setLoading = useAirspaceStore((s) => s.setLoading);
  const setError = useAirspaceStore((s) => s.setError);
  const setSelectedPoint = useAirspaceStore((s) => s.setSelectedPoint);
  const setFlyability = useAirspaceStore((s) => s.setFlyability);
  const airspaceLoading = useAirspaceStore((s) => s.loading);
  const updateAircraft = useTrafficStore((s) => s.updateAircraft);
  const setThreatLevels = useTrafficStore((s) => s.setThreatLevels);
  const addAlert = useTrafficStore((s) => s.addAlert);
  const setPolling = useTrafficStore((s) => s.setPolling);

  const handleViewerReady = useCallback((v: CesiumViewer) => setViewer(v), []);

  // Viewport awareness: camera altitude, visible airports, auto-panel
  const viewportAwareness = useViewportAwareness(viewer);

  // ── Load all airspace zones on mount ──
  useEffect(() => {
    setLoading(true);
    setError(null);

    const bbox = { south: -60, north: 70, west: -180, east: 180 };

    loadAllAirspaceZones(bbox, openAipKey)
      .then((zones) => {
        setZones(zones);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load airspace data");
        setLoading(false);
      });
  }, [setZones, setLoading, setError, openAipKey]);

  // ── Load NOTAMs on mount ──
  useEffect(() => {
    const bbox = { south: -60, north: 70, west: -180, east: 180 };
    fetchNotams(bbox)
      .then((notams) => {
        if (notams.length > 0) {
          useAirspaceStore.getState().setNotams(notams);
        }
      })
      .catch(() => {}); // graceful fallback
  }, []);

  // ── Convex cache state ──
  const [convexFailed, setConvexFailed] = useState(false);

  const handleConvexAdsbData = useCallback((data: { aircraft: any[]; source: string; fetchedAt: number }) => {
    if (!viewer || viewer.isDestroyed()) return;
    const result = fetchFromConvexCache(data);
    console.log(`[air-traffic] Convex cache: ${result.aircraft.length} aircraft globally`);
    useTrafficStore.getState().recordSuccess("convex-cache");
    setPolling(true);
    processAircraftRef.current(result.aircraft);
  }, [viewer, setPolling]);

  const handleConvexError = useCallback(() => {
    console.warn("[air-traffic] Convex ADS-B cache unavailable, falling back to direct fetch");
    setConvexFailed(true);
  }, []);

  // Process aircraft data (from Convex cache or direct polling fallback)
  const processAircraft = useCallback((aircraftResult: AircraftState[]) => {
    if (!viewer || viewer.isDestroyed()) return;

    updateAircraft(aircraftResult);

    // Compute threats relative to drone position (if connected) or camera center
    const camCartographic = Cartographic.fromCartesian(viewer.camera.positionWC);
    const camLat = CesiumMath.toDegrees(camCartographic.latitude);
    const camLon = CesiumMath.toDegrees(camCartographic.longitude);

    const telPos = useTelemetryStore.getState().position.latest();
    const refLat = telPos?.lat ?? camLat;
    const refLon = telPos?.lon ?? camLon;
    const refAlt = telPos?.alt ?? 0;

    const threats = computeAllThreats(refLat, refLon, refAlt, aircraftResult);
    const threatMap = new Map<string, ThreatLevel>();
    for (const t of threats) {
      threatMap.set(t.icao24, t.level);
    }

    // Skip setThreatLevels if unchanged to avoid unnecessary re-renders
    const existingThreats = useTrafficStore.getState().threatLevels;
    let threatsChanged = existingThreats.size !== threatMap.size;
    if (!threatsChanged) {
      for (const [k, v] of threatMap) {
        if (existingThreats.get(k) !== v) { threatsChanged = true; break; }
      }
    }
    if (threatsChanged) setThreatLevels(threatMap);

    // Generate alerts for RA/TA threats (deduplicated with 30s cooldown)
    const now = Date.now();
    for (const t of threats) {
      if (t.level !== "ra" && t.level !== "ta") continue;
      const lastAlert = lastAlertRef.current.get(t.icao24);
      if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) continue;

      lastAlertRef.current.set(t.icao24, now);
      const ac = aircraftResult.find((a) => a.icao24 === t.icao24);
      const alert: TrafficAlert = {
        id: randomId(),
        icao24: t.icao24,
        callsign: ac?.callsign ?? null,
        level: t.level,
        distanceKm: t.cpaDistance / 1000,
        altitudeDelta: t.altitudeDelta,
        timestamp: now,
        dismissed: false,
      };
      addAlert(alert);
    }
  }, [viewer, updateAircraft, setThreatLevels, addAlert]);

  // Keep a ref to processAircraft for use in callbacks that can't depend on it
  const processAircraftRef = useRef(processAircraft);
  processAircraftRef.current = processAircraft;

  // ── Fallback path: direct polling when Convex unavailable or errored ──
  const useDirectPolling = !convexAvailable || convexFailed;

  useEffect(() => {
    if (!useDirectPolling) return;
    if (!viewer || viewer.isDestroyed()) return;

    const pollInterval = useTrafficStore.getState().pollInterval;
    setPolling(true);

    async function poll() {
      if (viewer!.isDestroyed()) return;

      const camera = viewer!.camera;
      const cartographic = Cartographic.fromCartesian(camera.positionWC);
      const lat = CesiumMath.toDegrees(cartographic.latitude);
      const lon = CesiumMath.toDegrees(cartographic.longitude);

      try {
        const result = await fetchAircraft(lat, lon, 100);
        console.log(`[air-traffic] Direct fetch: ${result.aircraft.length} aircraft from ${result.source} (${lat.toFixed(2)}, ${lon.toFixed(2)}, r=100nm)`);
        useTrafficStore.getState().recordSuccess(result.source);
        processAircraftRef.current(result.aircraft);
      } catch (err) {
        useTrafficStore.getState().recordFailure(err instanceof Error ? err.message : "Fetch failed");
      }
    }

    // Pause polling when tab is hidden to save CPU/network
    let paused = false;
    const handleVisibility = () => {
      if (document.hidden) {
        paused = true;
        if (pollRef.current) clearInterval(pollRef.current);
      } else {
        paused = false;
        poll();
        pollRef.current = setInterval(poll, pollInterval);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    poll();
    pollRef.current = setInterval(poll, pollInterval);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      setPolling(false);
    };
  }, [useDirectPolling, viewer, setPolling]);

  // ── Consolidated click handler (globe + aircraft) ──
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler.setInputAction((click: any) => {
      const picked = viewer.scene.pick(click.position);

      // Entity or billboard click (aircraft, zone, notam, etc): let Cesium handle it
      if (defined(picked) && (picked.id || picked.primitive?.constructor?.name === "Billboard")) return;

      // Globe click: deselect any selected aircraft
      useTrafficStore.getState().setSelectedAircraft(null);

      // Globe click: flyability assessment
      const ray = viewer.camera.getPickRay(click.position);
      if (!ray) return;
      const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
      if (!cartesian) return;

      const cartographic = Cartographic.fromCartesian(cartesian);
      const lat = CesiumMath.toDegrees(cartographic.latitude);
      const lon = CesiumMath.toDegrees(cartographic.longitude);

      setSelectedPoint({ lat, lon });

      const state = useAirspaceStore.getState();
      const trafficState = useTrafficStore.getState();
      const autoJurisdiction = lookupJurisdiction(lat, lon);
      const effectiveJurisdiction = autoJurisdiction ?? jurisdiction;
      const result = assessFlyability(
        lat,
        lon,
        state.zones,
        state.notams,
        state.tfrs,
        Array.from(trafficState.aircraft.values()),
        effectiveJurisdiction,
        state.timelineTime,
      );
      setFlyability(result);
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      if (!handler.isDestroyed()) handler.destroy();
    };
  }, [viewer, jurisdiction, setSelectedPoint, setFlyability]);

  // ── Re-assess flyability when timeline time changes ──
  const timelineTime = useAirspaceStore((s) => s.timelineTime);
  useEffect(() => {
    const state = useAirspaceStore.getState();
    if (!state.selectedPoint) return;

    const { lat, lon } = state.selectedPoint;
    const trafficState = useTrafficStore.getState();
    const autoJurisdiction = lookupJurisdiction(lat, lon);
    const effectiveJurisdiction = autoJurisdiction ?? jurisdiction;
    const result = assessFlyability(
      lat,
      lon,
      state.zones,
      state.notams,
      state.tfrs,
      Array.from(trafficState.aircraft.values()),
      effectiveJurisdiction,
      state.timelineTime,
    );
    setFlyability(result);
  }, [timelineTime, jurisdiction, setFlyability]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      useAirspaceStore.getState().clear();
      useTrafficStore.getState().clear();
    };
  }, []);

  return (
    <div className="flex-1 relative min-w-0 h-full">
      {convexAvailable && !convexFailed && (
        <ConvexErrorBoundary onError={handleConvexError}>
          <ConvexCesiumToken onToken={handleCesiumToken} />
          <ConvexOpenAIPKey onKey={handleOpenAIPKey} />
          <ConvexAdsbCache onData={handleConvexAdsbData} />
        </ConvexErrorBoundary>
      )}
      <CesiumScene
        cesiumToken={cesiumToken}
        onReady={handleViewerReady}
        onError={(e) => setViewerError(e.message)}
        imageryMode={cesiumImageryMode}
        buildingsEnabled={cesiumBuildingsEnabled}
        terrainExaggeration={terrainExaggeration}
      />

      {/* Entity layers */}
      <AirspaceVolumeEntities viewer={viewer} />
      <AircraftEntities viewer={viewer} />
      <DronePositionEntity viewer={viewer} />
      <NotamEntities viewer={viewer} />
      <ZoneBoundaryEntities viewer={viewer} />
      <AirportEntities viewer={viewer} />
      <FlightTrailEntities viewer={viewer} />

      {/* Overlays */}
      <ConnectionBanner />
      <FlyabilityOverlay />
      <TimelineScrubber />
      <AltitudeSlider />
      <StatsOverlay />

      {/* Panels */}
      <LayerControlPanel />
      <AirspaceInfoPanel />
      <AlertsPanel />
      <LocationSearchPanel viewer={viewer} />
      <FlightSearchPanel viewer={viewer} />
      <AircraftDetailPanel />
      {viewportAwareness.autoPanel?.type === "airport" && (
        <AirportDetailPanel airport={viewportAwareness.autoPanel.airport} />
      )}

      {/* Controls */}
      <AirTrafficMapControls hasIonToken={!!cesiumToken} />
      <AirTrafficToolbar viewer={viewer} />

      {/* Zone loading indicator */}
      {airspaceLoading && (
        <div className="absolute top-[5.5rem] left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="flex items-center gap-2 bg-bg-primary/80 backdrop-blur-md rounded-lg px-4 py-2 border border-border-default">
            <div className="w-3 h-3 border border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
            <p className="text-xs text-text-secondary">Loading airspace zones...</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {!viewer && !viewerError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
            <p className="text-sm text-text-secondary">Initializing 3D view...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {viewerError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-bg-primary/80 backdrop-blur-md rounded-lg px-6 py-4 border border-red-500/30 text-center max-w-sm">
            <p className="text-sm text-red-400">3D view failed: {viewerError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
