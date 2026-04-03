/**
 * @module AirTrafficViewer
 * @description Composition root for the Airspace 3D view.
 * Renders CesiumJS globe with airspace zones, drone position,
 * NOTAMs, and all control panels/overlays. Manages zone loading
 * lifecycle and flyability assessment on globe click.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useCallback, useRef, Component, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Cartographic, ScreenSpaceEventHandler, ScreenSpaceEventType, Math as CesiumMath, defined, type Viewer as CesiumViewer } from "cesium";
import dynamic from "next/dynamic";
import { useAirspaceStore } from "@/stores/airspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { communityApi } from "@/lib/community-api";
import type { AirspaceZone, BoundingBox } from "@/lib/airspace/types";
import { loadAllAirspaceZones } from "@/lib/airspace/airspace-provider";
import { rehydrateZones } from "@/lib/airspace/convex-zone-adapter";
import { fetchNotams } from "@/lib/airspace/notam-provider";
import { fetchFaaTfrs } from "@/lib/airspace/faa-tfr-provider";
import { assessFlyability } from "@/lib/airspace/flyability";
import { lookupJurisdiction } from "@/lib/airspace/jurisdiction-lookup";

const JURISDICTION_BBOX: Record<string, BoundingBox> = {
  dgca:   { south: 6,  north: 36, west: 68,   east: 98 },
  faa:    { south: 24, north: 50, west: -125, east: -66 },
  casa:   { south: -45, north: -10, west: 112, east: 154 },
  easa:   { south: 34, north: 72, west: -12,  east: 45 },
  caa_uk: { south: 49, north: 61, west: -8,   east: 2 },
  caac:   { south: 18, north: 54, west: 73,   east: 135 },
  jcab:   { south: 24, north: 46, west: 123,  east: 146 },
  tcca:   { south: 41, north: 84, west: -141, east: -52 },
};
const DEFAULT_BBOX: BoundingBox = JURISDICTION_BBOX.dgca; // India default

import { AirspaceVolumeEntities } from "./entities/AirspaceVolumeEntities";
import { DronePositionEntity } from "./entities/DronePositionEntity";
import { NotamEntities } from "./entities/NotamEntities";
import { ZoneBoundaryEntities } from "./entities/ZoneBoundaryEntities";
import { AirportEntities } from "./entities/AirportEntities";
import { LayerControlPanel } from "./panels/LayerControlPanel";
import { AirspaceInfoPanel } from "./panels/AirspaceInfoPanel";
import { LocationSearchPanel } from "./panels/LocationSearchPanel";
import { FlyabilityOverlay } from "./overlays/FlyabilityOverlay";
import { ViewportStatsOverlay } from "./overlays/ViewportStatsOverlay";
import { AirTrafficMapControls } from "./controls/AirTrafficMapControls";
import { AirTrafficToolbar } from "./controls/AirTrafficToolbar";
import { AirportDetailPanel } from "./panels/AirportDetailPanel";
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

/** Fetches ALL pre-computed airspace zones from Convex (all jurisdictions at once). */
function ConvexAirspaceZones({ onZones }: {
  onZones: (zones: AirspaceZone[] | null) => void;
}) {
  const data = useQuery(communityApi.airspaceZones.getAll);
  useEffect(() => {
    if (data === undefined) return; // still loading from Convex
    if (!data || data.length === 0) {
      onZones(null); // no server data, fall back to client-side
      return;
    }
    // Merge all jurisdictions into one array
    const allZones: AirspaceZone[] = [];
    for (const doc of data) {
      allZones.push(...rehydrateZones(doc.zones));
    }
    onZones(allZones);
  }, [data, onZones]);
  return null;
}

/** Error boundary that silently catches Convex query errors. */
class ConvexErrorBoundary extends Component<{ children: ReactNode; onError?: () => void }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() { return this.state.hasError ? null : this.props.children; }
}

export function AirTrafficViewer() {
  const t = useTranslations("airTraffic");
  const [viewer, setViewer] = useState<CesiumViewer | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const convexAvailable = useConvexAvailable();
  const [cesiumToken, setCesiumToken] = useState<string | undefined>(undefined);
  const handleCesiumToken = useCallback((t: string | null) => {
    setCesiumToken(t ?? undefined);
  }, []);
  const [openAipKey, setOpenAipKey] = useState<string | null>(null);
  const handleOpenAIPKey = useCallback((k: string | null) => setOpenAipKey(k), []);
  const [convexFailed, setConvexFailed] = useState(false);

  // Convex zone state: undefined = loading, null = no server data, array = got zones
  const [convexZones, setConvexZones] = useState<AirspaceZone[] | null | undefined>(undefined);
  const handleConvexZones = useCallback((zones: AirspaceZone[] | null) => {
    setConvexZones(zones);
  }, []);

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

  const handleViewerReady = useCallback((v: CesiumViewer) => setViewer(v), []);

  // Viewport awareness: camera altitude, visible airports, auto-panel
  const viewportAwareness = useViewportAwareness(viewer);

  const handleConvexError = useCallback(() => {
    console.warn("[air-traffic] Convex query error, falling back gracefully");
    setConvexFailed(true);
  }, []);

  // ── Load all airspace zones (Convex-first, client-side fallback) ──
  useEffect(() => {
    // Convex data arrived → use it (instant, no spinner)
    if (Array.isArray(convexZones)) {
      setZones(convexZones);
      setLoading(false);
      return;
    }

    // Still waiting for Convex response
    if (convexZones === undefined && convexAvailable && !convexFailed) {
      setLoading(true);
      return;
    }

    // Convex returned null or unavailable → client-side fallback
    setLoading(true);
    setError(null);
    useAirspaceStore.getState().setTfrs([]);

    const bbox = JURISDICTION_BBOX[jurisdiction ?? ""] ?? DEFAULT_BBOX;

    const timeoutPromise = new Promise<AirspaceZone[]>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 15000)
    );

    Promise.race([loadAllAirspaceZones(bbox, openAipKey), timeoutPromise])
      .then((zones) => {
        setZones(zones);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.message === "timeout") {
          console.warn("[air-traffic] Zone loading timed out after 15s");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load airspace data");
        }
        setLoading(false);
      });
  }, [convexZones, convexAvailable, convexFailed, setZones, setLoading, setError, openAipKey, jurisdiction]);

  // ── Load NOTAMs (scoped to jurisdiction bbox) ──
  useEffect(() => {
    const bbox = JURISDICTION_BBOX[jurisdiction ?? ""] ?? DEFAULT_BBOX;
    fetchNotams(bbox)
      .then((notams) => {
        if (notams.length > 0) {
          useAirspaceStore.getState().setNotams(notams);
        }
      })
      .catch(() => {}); // graceful fallback
  }, [jurisdiction]);

  // ── Load FAA TFRs (when jurisdiction overlaps US) ──
  useEffect(() => {
    const bbox = JURISDICTION_BBOX[jurisdiction ?? ""] ?? DEFAULT_BBOX;
    // Only fetch FAA TFRs when the bbox overlaps US territory
    const usBbox = JURISDICTION_BBOX.faa;
    const overlapsUs =
      bbox.south <= usBbox.north &&
      bbox.north >= usBbox.south &&
      bbox.west <= usBbox.east &&
      bbox.east >= usBbox.west;

    if (!overlapsUs) return;

    fetchFaaTfrs(bbox)
      .then((tfrs) => {
        if (tfrs.length > 0) {
          useAirspaceStore.getState().setTfrs(tfrs);
        }
      })
      .catch(() => {}); // graceful fallback
  }, [jurisdiction]);

  // ── Consolidated click handler (globe) ──
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler.setInputAction((click: any) => {
      const picked = viewer.scene.pick(click.position);

      // Entity click (zone, notam, etc): let Cesium handle it
      if (defined(picked) && picked.id) return;

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
      const autoJurisdiction = lookupJurisdiction(lat, lon);
      const effectiveJurisdiction = autoJurisdiction ?? jurisdiction;
      const result = assessFlyability(
        lat,
        lon,
        state.zones,
        state.notams,
        state.tfrs,
        effectiveJurisdiction,
        new Date(),
      );
      setFlyability(result);
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      if (!handler.isDestroyed()) handler.destroy();
    };
  }, [viewer, jurisdiction, setSelectedPoint, setFlyability]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      useAirspaceStore.getState().clear();
    };
  }, []);

  return (
    <div className="flex-1 relative min-w-0 h-full">
      {convexAvailable && !convexFailed && (
        <ConvexErrorBoundary onError={handleConvexError}>
          <ConvexCesiumToken onToken={handleCesiumToken} />
          <ConvexOpenAIPKey onKey={handleOpenAIPKey} />
          <ConvexAirspaceZones onZones={handleConvexZones} />
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
      <DronePositionEntity viewer={viewer} />
      <NotamEntities viewer={viewer} />
      <ZoneBoundaryEntities viewer={viewer} />
      <AirportEntities viewer={viewer} />

      {/* Overlays */}
      <FlyabilityOverlay />
      <ViewportStatsOverlay />

      {/* Panels */}
      <LayerControlPanel />
      <AirspaceInfoPanel />
      <LocationSearchPanel viewer={viewer} />
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
            <p className="text-xs text-text-secondary">{t("loadingZones")}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {!viewer && !viewerError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
            <p className="text-sm text-text-secondary">{t("initializing3D")}</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {viewerError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-bg-primary/80 backdrop-blur-md rounded-lg px-6 py-4 border border-red-500/30 text-center max-w-sm">
            <p className="text-sm text-red-400">{t("viewFailed", { error: viewerError })}</p>
          </div>
        </div>
      )}
    </div>
  );
}
