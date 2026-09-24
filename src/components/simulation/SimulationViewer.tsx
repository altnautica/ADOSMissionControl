/**
 * @module SimulationViewer
 * @description Composition root for the mission simulation 3D view.
 * Delegates CesiumJS concerns to focused hooks: useSimClock (clock lifecycle),
 * useSimCamera (camera state machine), useSimCompletion (history recording).
 * Entity components render renderlessly into the CesiumJS viewer.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { Viewer as CesiumViewer } from "cesium";
import type { AltitudeFrame, Waypoint } from "@/lib/types";
import {
  computeFlightPlan,
  createSimulationMissionSignature,
} from "@/lib/simulation-utils";
import { buildSampledProperties } from "@/lib/build-sampled-properties";
import { makeKinematicViewerTrack, type ViewerTrack } from "@/lib/simulation/viewer-track";
import { resolveAGLToAbsolute, type ResolvedPath } from "@/lib/terrain-utils";
import { useSimulationStore } from "@/stores/simulation-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSimClock } from "@/hooks/use-sim-clock";
import { useSimCamera } from "@/hooks/use-sim-camera";
import { useSimAutoFollow } from "@/hooks/use-sim-auto-follow";
import { useSimCompletion } from "@/hooks/use-sim-completion";
import { useTerrainReady } from "@/hooks/use-terrain-ready";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { communityApi } from "@/lib/community-api";

import { MapPin } from "lucide-react";
import CesiumScene from "./CesiumScene";
import { FlightPathEntity } from "./FlightPathEntity";
import { WaypointEntities } from "./WaypointEntities";
import { ActualPathEntity } from "./ActualPathEntity";
import { DroneEntity } from "./DroneEntity";
import { DroneTrailEntity } from "./DroneTrailEntity";
import { GcsEntity } from "./GcsEntity";
import { CameraTriggerEntities } from "./CameraTriggerEntities";
import { GeofenceEntities } from "./GeofenceEntities";
import { RallyPointEntities } from "./RallyPointEntities";
import { PatternBoundaryEntities } from "./PatternBoundaryEntities";
import { PlaybackControls } from "./PlaybackControls";
import { SimulationHUD } from "./SimulationHUD";
import { MapControlsPanel } from "./MapControlsPanel";
import { MissionWarningBanner } from "./MissionWarningBanner";
import { SimCameraCluster } from "./SimCameraCluster";

/** Fetches Cesium Ion token from Convex. Only mount when Convex is available. */
function ConvexCesiumToken({ onToken }: { onToken: (token: string | null) => void }) {
  // Parent already mounts this only when Convex is available. Bypass the demo
  // check so simulation in demo mode still pulls the token when the backend
  // is reachable.
  const config = useConvexSkipQuery(communityApi.clientConfig.get, { skipDemoCheck: true });
  useEffect(() => {
    // config is undefined while loading, null if query not found
    if (config !== undefined) {
      onToken((config as { cesiumIonToken?: string } | null)?.cesiumIonToken ?? null);
    }
  }, [config, onToken]);
  return null;
}

interface SimulationViewerProps {
  waypoints: Waypoint[];
  defaultSpeed: number;
  /** Planner default frame: the frame the upload gives a frameless waypoint. */
  defaultFrame: AltitudeFrame;
}

interface TerrainResultState {
  signature: string;
  path: ResolvedPath | null;
  failed: boolean;
}

export function SimulationViewer({ waypoints, defaultSpeed, defaultFrame }: SimulationViewerProps) {
  const t = useTranslations("simulate");
  const [viewer, setViewer] = useState<CesiumViewer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const convexAvailable = useConvexAvailable();
  const [cesiumToken, setCesiumToken] = useState<string | undefined>(undefined);
  const handleCesiumToken = useCallback((t: string | null) => {
    setCesiumToken(t ?? undefined);
  }, []);
  const effectiveCesiumToken =
    cesiumToken ?? process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? undefined;

  // Map control settings
  const cesiumImageryMode = useSettingsStore((s) => s.cesiumImageryMode);
  const cesiumQuality = useSettingsStore((s) => s.cesiumQuality);
  const cesiumBuildingsEnabled = useSettingsStore((s) => s.cesiumBuildingsEnabled);
  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
  const showPathLabels = useSettingsStore((s) => s.showPathLabels);
  const showCameraTriggers = useSettingsStore((s) => s.showCameraTriggers);

  // Relative-frame altitudes are measured from home: the vehicle's reported
  // HOME_POSITION when there is one, else the launch point the upload uses.
  const vehicleHomeLat = useTelemetryStore((s) => s.homePosition.latest()?.lat);
  const vehicleHomeLon = useTelemetryStore((s) => s.homePosition.latest()?.lon);
  const homeLat = vehicleHomeLat ?? waypoints[0]?.lat;
  const homeLon = vehicleHomeLon ?? waypoints[0]?.lon;

  const missionSignature = useMemo(
    () => createSimulationMissionSignature(waypoints, defaultSpeed, defaultFrame),
    [waypoints, defaultSpeed, defaultFrame]
  );

  const flightPlan = useMemo(
    () => computeFlightPlan(waypoints, defaultSpeed),
    [waypoints, defaultSpeed]
  );

  // ── Terrain readiness — wait for real provider before sampling ──
  const { isReady: terrainReady, version: terrainVersion } = useTerrainReady(viewer);

  // ── Terrain-resolved positions for 3D flight path ──────────
  const [terrainResult, setTerrainResult] = useState<TerrainResultState | null>(null);

  const resolvedPath =
    terrainResult?.signature === missionSignature && !terrainResult.failed
      ? terrainResult.path
      : null;
  const terrainFailed =
    terrainResult?.signature === missionSignature && terrainResult.failed;
  const terrainResolving =
    !!viewer && !viewer.isDestroyed() && waypoints.length >= 2 && !resolvedPath && !terrainFailed;

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || waypoints.length < 2) {
      return;
    }

    // Don't sample while terrain provider is still the flat ellipsoid —
    // it returns height=0 everywhere, placing the path underground.
    if (!terrainReady) {
      return;
    }

    let cancelled = false;
    const terrainProvider = viewer.scene.globe.terrainProvider;
    const signature = missionSignature;

    if (homeLat === undefined || homeLon === undefined) return;
    resolveAGLToAbsolute(waypoints, terrainProvider, defaultFrame, { lat: homeLat, lon: homeLon })
      .then((result) => {
        if (!cancelled) {
          setTerrainResult({ signature, path: result, failed: false });
        }
      })
      .catch(() => {
        // Terrain sampling failed — FlightPathEntity falls back to clamped path
        if (!cancelled) {
          setTerrainResult({ signature, path: null, failed: true });
        }
      });

    return () => { cancelled = true; };
  }, [viewer, missionSignature, waypoints, defaultFrame, terrainReady, terrainVersion, homeLat, homeLon]);

  // Extract waypoint-only resolved positions for WaypointEntities + camera
  const waypointPositions = useMemo(() => {
    if (!resolvedPath) return undefined;
    return resolvedPath.waypointIndices.map((idx) => resolvedPath.positions[idx]);
  }, [resolvedPath]);

  const hasAbsolutePositions = !!waypointPositions;

  const sampled = useMemo(
    () => buildSampledProperties(
      waypoints,
      flightPlan,
      waypointPositions,
      resolvedPath?.positions,
      resolvedPath?.waypointIndices,
      resolvedPath?.homeTerrainHeight,
    ),
    [waypoints, flightPlan, waypointPositions, resolvedPath]
  );

  // Renderable tracks under the shared sim clock. Today this is the single planned
  // kinematic path; a recorded-replay or live track appends here later. The kinematic
  // track wraps `sampled` verbatim, so a one-track set renders identically to before.
  const tracks = useMemo<ViewerTrack[]>(
    () => [
      makeKinematicViewerTrack(
        sampled,
        hasAbsolutePositions,
        !terrainResolving || hasAbsolutePositions,
      ),
    ],
    [sampled, hasAbsolutePositions, terrainResolving],
  );

  // Reset simulation when waypoints change
  useEffect(() => {
    useSimulationStore.getState().reset();
  }, [missionSignature]);

  // Sync total duration
  useEffect(() => {
    useSimulationStore.getState().setTotalDuration(flightPlan.totalDuration);
  }, [missionSignature, flightPlan.totalDuration]);

  // Hooks handle all CesiumJS lifecycle
  useSimClock(viewer, sampled, flightPlan.totalDuration, hasAbsolutePositions, flightPlan);
  useSimCamera(viewer, waypoints, flightPlan, waypointPositions);
  useSimAutoFollow();
  useSimCompletion(waypoints);

  const handleViewerReady = useCallback((v: CesiumViewer) => setViewer(v), []);

  return (
    <div className="flex-1 relative min-w-0 h-full">
      {convexAvailable && <ConvexCesiumToken onToken={handleCesiumToken} />}
      <CesiumScene
        cesiumToken={effectiveCesiumToken}
        onReady={handleViewerReady}
        onError={(e) => setViewerError(e.message)}
        imageryMode={cesiumImageryMode}
        quality={cesiumQuality}
        buildingsEnabled={cesiumBuildingsEnabled}
        terrainExaggeration={terrainExaggeration}
      />

      <FlightPathEntity
        viewer={viewer}
        waypoints={waypoints}
        defaultFrame={defaultFrame}
        resolvedPositions={resolvedPath?.positions ?? null}
        waypointIndices={resolvedPath?.waypointIndices}
        terrainHeights={resolvedPath?.terrainHeights}
        homeTerrainHeight={resolvedPath?.homeTerrainHeight}
        showLabels={showPathLabels}
        isResolving={terrainResolving}
      />
      <WaypointEntities viewer={viewer} waypoints={waypoints} resolvedPositions={waypointPositions} />
      <ActualPathEntity viewer={viewer} />
      {tracks.map((track) => (
        <DroneEntity
          key={track.id}
          viewer={viewer}
          trackId={track.id}
          positionProperty={track.sampled?.sampledPosition ?? null}
          headingProperty={track.sampled?.sampledHeading ?? null}
          useAbsoluteAlt={track.useAbsoluteAlt}
          visible={track.visible}
        />
      ))}
      {tracks.map((track) => (
        <DroneTrailEntity
          key={track.id}
          viewer={viewer}
          trackId={track.id}
          positionProperty={track.sampled?.sampledPosition ?? null}
        />
      ))}
      <GcsEntity viewer={viewer} />
      <CameraTriggerEntities viewer={viewer} waypoints={waypoints} visible={showCameraTriggers} />
      <GeofenceEntities viewer={viewer} homeHeight={resolvedPath?.homeTerrainHeight} />
      <RallyPointEntities
        viewer={viewer}
        homeHeight={resolvedPath?.homeTerrainHeight}
        terrainVersion={terrainVersion}
      />
      <PatternBoundaryEntities viewer={viewer} />

      <MissionWarningBanner waypoints={waypoints} />
      <MapControlsPanel hasIonToken={!!effectiveCesiumToken} />
      <SimulationHUD />
      <PlaybackControls waypoints={waypoints} totalDuration={flightPlan.totalDuration} />
      {viewer && <SimCameraCluster viewer={viewer} />}

      {/* Loading state */}
      {!viewer && !viewerError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
            <p className="text-sm text-text-secondary">{t("initializing3dView")}</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {viewerError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-bg-primary/80 backdrop-blur-md rounded-lg px-6 py-4 border border-status-error/30 text-center max-w-sm">
            <p className="text-sm text-status-error">
              {t("viewFailed", { message: viewerError })}
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {waypoints.length < 2 && !viewerError && viewer && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-bg-primary/80 backdrop-blur-md rounded-lg px-8 py-6 border border-border-default text-center max-w-xs">
            <MapPin size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="text-sm font-semibold text-text-primary mb-1">
              {t("noFlightPlanLoaded")}
            </p>
            <p className="text-xs text-text-tertiary">
              {t("addWaypointsOrLoadPlan")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
