/**
 * @module Planner3DView
 * @description The planner's 3D view: the plan on Cesium terrain with the
 * same scene layers as the Simulate tab, minus playback. Waypoints are placed,
 * selected, moved and raised here through the planner's own handlers, so every
 * edit lands in the same mission and undo history as the 2D map.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Cartesian3, Cartographic, type Viewer as CesiumViewer } from "cesium";
import { useSettingsStore } from "@/stores/settings-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import CesiumScene from "@/components/simulation/CesiumScene";
import { ConvexCesiumToken } from "@/components/simulation/ConvexCesiumToken";
import { useResolvedMissionPath } from "@/components/simulation/use-resolved-mission-path";
import { ViewerFailedCard } from "@/components/simulation/ViewerFailedCard";
import { FlightPathEntity } from "@/components/simulation/FlightPathEntity";
import { WaypointEntities } from "@/components/simulation/WaypointEntities";
import { GcsEntity } from "@/components/simulation/GcsEntity";
import { CameraTriggerEntities } from "@/components/simulation/CameraTriggerEntities";
import { GeofenceEntities } from "@/components/simulation/GeofenceEntities";
import { RallyPointEntities } from "@/components/simulation/RallyPointEntities";
import { PatternBoundaryEntities } from "@/components/simulation/PatternBoundaryEntities";
import { MapControlsPanel } from "@/components/simulation/MapControlsPanel";
import type { PlannerMapProps } from "./PlannerMap";
import { usePlanner3DCamera } from "./three/use-planner-3d-camera";
import { usePlanner3DInput } from "./three/use-planner-3d-input";

export function Planner3DView({
  waypoints, onMapClick, onMapRightClick, onWaypointClick, onWaypointDragEnd, onWaypointRightClick,
}: PlannerMapProps) {
  const t = useTranslations("simulate");
  const tPlanner = useTranslations("planner.view3d");
  const [viewer, setViewer] = useState<CesiumViewer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const convexAvailable = useConvexAvailable();
  const [cesiumToken, setCesiumToken] = useState<string | undefined>(undefined);
  const handleCesiumToken = useCallback((token: string | null) => setCesiumToken(token ?? undefined), []);
  const effectiveCesiumToken = cesiumToken ?? process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? undefined;

  const cesiumImageryMode = useSettingsStore((s) => s.cesiumImageryMode);
  const cesiumQuality = useSettingsStore((s) => s.cesiumQuality);
  const cesiumBuildingsEnabled = useSettingsStore((s) => s.cesiumBuildingsEnabled);
  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
  const showPathLabels = useSettingsStore((s) => s.showPathLabels);
  const showCameraTriggers = useSettingsStore((s) => s.showCameraTriggers);
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);

  const { resolvedPath, waypointPositions, terrainFailed, terrainResolving, terrainVersion } =
    useResolvedMissionPath(viewer, waypoints, defaultSpeed, defaultFrame);

  // Frame the resolved positions; with fewer than two waypoints (nothing to
  // resolve) or a failed terrain sample, frame the raw waypoints over the
  // ground loaded so far. Undefined while the resolution is still running.
  const framePositions = useMemo(() => {
    if (waypoints.length === 0) return [];
    if (waypointPositions) return waypointPositions;
    if (!viewer || viewer.isDestroyed() || (waypoints.length >= 2 && !terrainFailed)) return undefined;
    const globe = viewer.scene.globe;
    return waypoints
      .filter((w) => w.lat !== 0 || w.lon !== 0)
      .map((w) => Cartesian3.fromDegrees(w.lon, w.lat, (globe.getHeight(Cartographic.fromDegrees(w.lon, w.lat)) ?? 0) + w.alt));
  }, [viewer, waypoints, waypointPositions, terrainFailed]);
  usePlanner3DCamera(viewer, framePositions);

  const handlers = useMemo(
    () => ({ onMapClick, onMapRightClick, onWaypointClick, onWaypointDragEnd, onWaypointRightClick }),
    [onMapClick, onMapRightClick, onWaypointClick, onWaypointDragEnd, onWaypointRightClick],
  );
  usePlanner3DInput(viewer, handlers, waypoints, defaultFrame);

  const handleViewerReady = useCallback((v: CesiumViewer) => setViewer(v), []);
  const handleViewerError = useCallback((e: Error) => setViewerError(e.message), []);
  // Bumped by Retry: a new key remounts the Cesium scene from scratch.
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const handleRetry = useCallback(() => {
    setViewer(null);
    setViewerError(null);
    setSceneAttempt((n) => n + 1);
  }, []);

  return (
    <div className="absolute inset-0">
      {convexAvailable && <ConvexCesiumToken onToken={handleCesiumToken} />}
      <CesiumScene
        key={sceneAttempt}
        cesiumToken={effectiveCesiumToken}
        onReady={handleViewerReady}
        onError={handleViewerError}
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
      <WaypointEntities viewer={viewer} waypoints={waypoints} resolvedPositions={waypointPositions} selectOnClick={false} />
      <GcsEntity viewer={viewer} />
      <CameraTriggerEntities viewer={viewer} waypoints={waypoints} visible={showCameraTriggers} />
      <GeofenceEntities viewer={viewer} homeHeight={resolvedPath?.homeTerrainHeight} />
      <RallyPointEntities viewer={viewer} homeHeight={resolvedPath?.homeTerrainHeight} terrainVersion={terrainVersion} />
      <PatternBoundaryEntities viewer={viewer} />

      <MapControlsPanel hasIonToken={!!effectiveCesiumToken} placement="top-3 right-3" />

      <div className="absolute bottom-3 left-3 z-10 pointer-events-none rounded-md border border-border-default bg-bg-primary/80 px-2.5 py-1 text-[11px] text-text-secondary backdrop-blur-md">
        {tPlanner("hint")}
      </div>

      {!viewer && !viewerError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
            <p className="text-sm text-text-secondary">{t("initializing3dView")}</p>
          </div>
        </div>
      )}

      {viewerError && (
        <ViewerFailedCard
          message={viewerError}
          onRetry={handleRetry}
          fallback={{ label: t("switchTo2d"), onClick: () => usePlannerStore.getState().setMapView("2d") }}
        />
      )}
    </div>
  );
}
