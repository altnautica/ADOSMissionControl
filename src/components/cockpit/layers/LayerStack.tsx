"use client";

/**
 * @module cockpit/layers/LayerStack
 * @description Every data layer over the cockpit's main video, in one
 * canvas: targets (detection glyphs, cockpit marks, lead reticle), AR route
 * and motion, obstacles, depth and surfaces, in the cockpit spec's z-order.
 * Mounted once inside the main video; the PiP draws no layers.
 *
 * The canvas is drawn by a {@link LayerEngine} outside React. Overlay frames
 * live in a mutable frame store, so a frame never re-renders this component:
 * it re-renders only when the level, a layer switch, the view, the camera or
 * its size changes. The target controller beneath it re-renders at detection
 * rate for its click areas.
 *
 * Leases: while the page is visible this layer holds a nav-stream view lease
 * for its camera and the leased layers it draws, and a vision-demand lease of
 * kind `depth` / `surfaces` while those layers are on. A hidden page releases
 * them and stops the draw loop.
 *
 * @license GPL-3.0-only
 */

import { isDemoMode } from "@/lib/utils";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { TargetController } from "@/components/cockpit/layers/TargetController";
import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import { useDetectionDemand } from "@/hooks/use-detection-demand";
import { useElementSize } from "@/hooks/use-element-size";
import { LayerEngine } from "@/lib/cockpit/layers/engine";
import type { FlightContext } from "@/lib/cockpit/layers/engine-types";
import { resolveTargetStyle } from "@/lib/cockpit/layers/draw-targets";
import { effectiveLayers, type LayerStackView } from "@/lib/cockpit/layers/layer-spec";
import {
  LEASED_LAYERS,
  holdViewLease,
  viewDemand,
  type LeasedLayer,
  type ViewLeaseHandle,
} from "@/lib/cockpit/layers/view-lease";
import { useCockpitLayersStore, vehicleLayers } from "@/stores/cockpit-layers-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

/** The draw cap on a kiosk / TV, whose GPU also decodes the video. */
const TV_FPS_CAP = 30;

export interface LayerStackProps {
  droneId: string;
  /** Served camera id of the main video ("main" for the primary). */
  cameraId: string;
  view: LayerStackView;
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** Live flight context for the AR layout, read at draw time into `out`. A
 * `loaded` mission previews only while disarmed or owner ∈ {pilot, fc_mode}. */
function readFlight(droneId: string, out: FlightContext): void {
  const p = useNavStreamStore.getState().byDrone[droneId]?.pilot?.data ?? null;
  out.mission = p?.mission ?? null;
  out.avoid = p?.avoidState ?? null;
  out.showLoaded = !p || !p.armed || p.owner === "pilot" || p.owner === "fc_mode";
}

/** Commit counter for the performance gate (zero commits while frames stream). */
export const layerStackStats = { commits: 0 };

/** Memoised: its props are primitives, so the cockpit's own re-renders (at
 * telemetry rate) never re-render the layer stack. */
export const LayerStack = memo(function LayerStack({ droneId, cameraId, view }: LayerStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(containerRef);
  const widthClass = useCockpitWidthClass();
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => false,
  );

  const vl = useCockpitLayersStore((s) => vehicleLayers(s.byVehicle, droneId));
  const layers = useMemo(() => effectiveLayers(vl.level, vl.flips, view), [vl.level, vl.flips, view]);

  const droneRef = useRef(droneId);
  droneRef.current = droneId;
  const [engine] = useState(() => new LayerEngine((out) => readFlight(droneRef.current, out)));
  const tChip = useTranslations("cockpitLayers.chip");
  useEffect(() => {
    engine.setChipText({
      arUnavailable: tChip("arUnavailable"),
      arApprox: tChip("arApprox"),
      depthUnavailable: tChip("depthUnavailable"),
      depthUnscaled: tChip("depthUnscaled"),
      surfacesUnavailable: tChip("surfacesUnavailable"),
      obstaclesUnavailable: tChip("obstaclesUnavailable"),
      targetsUnavailable: tChip("targetsUnavailable"),
    });
  }, [engine, tChip]);

  useEffect(() => {
    layerStackStats.commits += 1;
  });

  // Canvas attach, perf hook for the browser gate.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    engine.attach(canvas);
    // Browser test seam (demo builds only): read draw timings, commits and the
    // view demand; flip layers on the shown vehicle the same way the layer
    // menu does.
    if (!isDemoMode()) return () => engine.detach();
    const w = window as unknown as {
      __adosLayers?: {
        engine: LayerEngine;
        stats: typeof layerStackStats;
        demand: () => Record<string, string[]>;
        setLayer: (id: string, on: boolean) => void;
      };
    };
    w.__adosLayers = {
      engine,
      stats: layerStackStats,
      demand: () => Object.fromEntries(viewDemand(droneRef.current)),
      setLayer: (id, on) => useCockpitLayersStore.getState().setLayer(droneRef.current, id, on),
    };
    return () => {
      engine.detach();
      if (w.__adosLayers?.engine === engine) delete w.__adosLayers;
    };
  }, [engine]);

  useEffect(() => engine.setRunning(visible), [engine, visible]);

  useEffect(() => {
    if (!size) return;
    engine.resize(size.w, size.h, window.devicePixelRatio || 1);
    if (containerRef.current) engine.setStyle(resolveTargetStyle(containerRef.current));
  }, [engine, size]);

  // The video's natural size gives the letterbox rect.
  useEffect(() => {
    const video = containerRef.current?.parentElement?.querySelector("video");
    if (!video) return;
    const read = () => engine.setVideoSize(video.videoWidth, video.videoHeight);
    read();
    video.addEventListener("loadedmetadata", read);
    video.addEventListener("resize", read);
    return () => {
      video.removeEventListener("loadedmetadata", read);
      video.removeEventListener("resize", read);
    };
  }, [engine, cameraId]);

  useEffect(() => {
    engine.setOptions({
      droneId,
      cameraId,
      level: vl.level,
      layers,
      depthMode: vl.depthStyle,
      depthRange: vl.depthRange,
      fpsCap: widthClass === "tv" ? TV_FPS_CAP : 0,
    });
  }, [engine, droneId, cameraId, vl.level, vl.depthStyle, vl.depthRange, layers, widthClass]);

  // Nav-stream view lease: the leased layers this view draws, while visible.
  const leased = useMemo<LeasedLayer[]>(
    () => LEASED_LAYERS.filter((l) => layers.has(l)),
    [layers],
  );
  const leaseRef = useRef<ViewLeaseHandle | null>(null);
  useEffect(() => {
    // Demo mode has no nav socket: the lease is held (and released) all the
    // same, it simply has nowhere to be sent.
    if (!visible) return;
    const handle = holdViewLease(droneId, cameraId, leased);
    leaseRef.current = handle;
    return () => {
      handle.release();
      leaseRef.current = null;
    };
    // The lease is re-targeted below without dropping it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, droneId]);
  useEffect(() => {
    leaseRef.current?.update(cameraId, leased);
  }, [cameraId, leased]);

  // Engine-side compute for depth and surfaces.
  useDetectionDemand(droneId, cameraId, layers.has("depth") && vl.depthRange !== "off", "depth");
  useDetectionDemand(droneId, cameraId, layers.has("surfaces"), "surfaces");

  return (
    <div ref={containerRef} className="tgt-layer" data-cockpit-layer="layer-stack" data-layer-level={vl.level}>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
      {layers.has("targets") && (
        <TargetController droneId={droneId} cameraId={cameraId} engine={engine} layerRef={containerRef} size={size} />
      )}
    </div>
  );
});
