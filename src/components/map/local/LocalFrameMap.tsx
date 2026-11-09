"use client";

/**
 * @module map/local/LocalFrameMap
 * @description The local-frame map: occupancy, SLAM trail, scan, origin,
 * follow target and drone, north-up in map metres, drawn on one
 * devicePixelRatio-aware canvas. Shared by the cockpit minimap's local mode
 * and the node-detail Map tab. Zoom 2–80 px/m by wheel or the `+` / `−`
 * buttons; drag pans, and the view recentres on the drone 10 s after the
 * last pan.
 *
 * @license GPL-3.0-only
 */

import { MissionPlanIdentityBanner } from "@/components/cockpit/v2/MissionPlanIdentityBanner";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";

import { useLocalFrameData } from "@/components/map/local/use-local-frame-data";
import { useOccupancyBitmaps } from "@/components/map/local/use-occupancy-bitmaps";
import {
  LOCAL_SCENE_VARS,
  paintLocalScene,
  type LocalSceneColours,
} from "@/components/map/local/paint-local-scene";
import {
  DEFAULT_LOCAL_ZOOM,
  buildLocalScene,
  stepZoom,
  viewCentre,
  wheelZoom,
} from "@/lib/nav/local-scene";
import { parseCssColor, type Rgba } from "@/lib/nav/occupancy-bitmap";
import { cn } from "@/lib/utils";

interface LocalFrameMapProps {
  droneId: string;
  className?: string;
  /** Extra header content, right-aligned (the minimap's frame toggle). */
  headerExtra?: ReactNode;
  /** A minimap: no plan-identity banner (the full map views carry it). */
  compact?: boolean;
}

/** Resolve the painter's colours from the element's computed `--hud-*`. */
function readColours(el: HTMLElement): LocalSceneColours {
  const style = getComputedStyle(el);
  const out = {} as LocalSceneColours;
  for (const [k, v] of Object.entries(LOCAL_SCENE_VARS) as Array<[keyof LocalSceneColours, string]>) {
    out[k] = style.getPropertyValue(v).trim();
  }
  if (!out.mono) out.mono = "ui-monospace, monospace";
  return out;
}

/** The ink colour as RGBA, normalised through the canvas when the computed
 * value is not hex / rgb(). */
function inkRgba(ink: string, ctx: CanvasRenderingContext2D | null): Rgba | null {
  const direct = parseCssColor(ink);
  if (direct || !ctx || !ink) return direct;
  ctx.fillStyle = ink;
  return parseCssColor(String(ctx.fillStyle));
}

export function LocalFrameMap({ droneId, className, headerExtra, compact = false }: LocalFrameMapProps) {
  const t = useTranslations("hud.map");
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number; north: number; east: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(DEFAULT_LOCAL_ZOOM);
  const [pan, setPan] = useState<{ north: number; east: number; at: number } | null>(null);
  const [ink, setInk] = useState<Rgba | null>(null);

  const data = useLocalFrameData(droneId);
  const bitmaps = useOccupancyBitmaps(droneId, data.occupancy, ink);
  const centre = viewCentre(pan, data.drone, data.now);
  const scene = buildLocalScene({
    width: size.width,
    height: size.height,
    view: { centreX: centre.north, centreY: centre.east, pxPerM: zoom, cx: size.width / 2, cy: size.height / 2 },
    occupancy: data.occupancy,
    occupancyStale: data.occupancyStale,
    trail: data.trail,
    scanPoints: data.scanPoints,
    target: data.target,
    drone: data.drone,
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => wheelZoom(z, e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // `scene` is rebuilt every render, so this repaints on every render; the
  // ink compare stops the colour resolve from looping.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colours = readColours(canvas);
    const nextInk = inkRgba(colours.ink, ctx);
    if (nextInk && (!ink || nextInk.join() !== ink.join())) setInk(nextInk);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintLocalScene(ctx, scene, size, colours, bitmaps.lookup, t("origin"));
  }, [size, ink, scene, bitmaps.lookup, t]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, north: centre.north, east: centre.east };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({
      north: d.north + (e.clientY - d.y) / zoom,
      east: d.east - (e.clientX - d.x) / zoom,
      at: Date.now(),
    });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div ref={wrapRef} className={cn("lfmap", className)}>
      {!compact && <MissionPlanIdentityBanner droneId={droneId} className="absolute left-1/2 top-2 z-[1001] -translate-x-1/2" />}
      <canvas
        ref={canvasRef}
        className="lfmap-canvas"
        style={{ width: size.width, height: size.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label={t("local")}
        role="img"
      />
      <div className="lfmap-head">
        <span className="lfmap-title lbl">{t("local")}</span>
        {data.fcPos && <span className="lfmap-fcpos lbl">{t("fcPos")}</span>}
        <span className="lfmap-spacer" />
        {headerExtra}
      </div>
      <div className="lfmap-zoom">
        <button type="button" onClick={() => setZoom((z) => stepZoom(z, 1))} aria-label={t("zoomIn")} title={t("zoomIn")}>
          <Plus size={12} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setZoom((z) => stepZoom(z, -1))} aria-label={t("zoomOut")} title={t("zoomOut")}>
          <Minus size={12} aria-hidden="true" />
        </button>
      </div>
      <div className="lfmap-scale lbl" data-scale-m={scene.scaleBar.m}>
        <span className="bar" style={{ width: scene.scaleBar.px }} />
        <span>{t("scaleBar", { m: scene.scaleBar.m })}</span>
      </div>
    </div>
  );
}
