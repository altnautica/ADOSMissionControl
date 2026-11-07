/**
 * @module cockpit/layers/engine
 * @description The layer stack's draw loop, outside React. One canvas per
 * video, sized to the container at `devicePixelRatio`; every layer is drawn
 * into it in the cockpit's z-order: targets (detections, marks, lead), AR
 * route and motion, obstacles, depth, surfaces.
 *
 * The loop draws only when something changed: a new frame in the frame store,
 * a new target scene, a resize, a layer or level change, an interpolation or
 * fade still in progress, or a staleness boundary (dim at 500 ms, hide at 2 s).
 * With nothing changed it schedules nothing. It stops while the page is hidden.
 *
 * Interpolation: AR ops of the same key move linearly between the last two
 * frames over the measured inter-frame interval; ops new in a frame fade in
 * over 120 ms and removed ones fade out. Layouts are recomputed only when a
 * frame, the rect or the options change; between them only the blend runs,
 * into reused buffers.
 *
 * @license GPL-3.0-only
 */

import { layoutAr } from "./ar-layout";
import {
  decodeBase64Into,
  type ArCamera,
  type AvoidState,
  type CameraGrid,
  type MissionState,
} from "./cockpit-frames";
import { drawTargets, type TargetScene, type TargetStyle } from "./draw-targets";
import { getFrames, subscribeFrames, type FrameSlot } from "./frame-store";
import {
  DrawOpBuffer,
  FADE_MS,
  containRect,
  layoutCells,
  layoutSectorArc,
  layoutZones,
  lerpOps,
  paintOps,
  type Rect,
} from "./layer-layout";
import type { LayerLevel } from "./ar-layout";
import { LAYER_DIM_MS, LAYER_HIDE_MS } from "./layer-spec";
import type { DepthRange, DepthStyle } from "@/stores/cockpit-layers-store";

const DIM_ALPHA = 0.45;
/** Obstacle cells drawn up to this range; red at or under the near limit. */
const OBSTACLE_MAX_M = 5;
const NEAR_M = 2;
/** Interpolation interval when only one frame has arrived. */
const DEFAULT_INTERVAL_MS = 100;


/** What the loop draws, set from React only when a toggle, the level, the
 * camera or the view changes. */
export interface LayerOptions {
  droneId: string;
  cameraId: string;
  level: LayerLevel;
  layers: ReadonlySet<string>;
  depthMode: DepthStyle;
  depthRange: DepthRange;
  /** Max frames per second (kiosk/TV: 30); 0 = display rate. */
  fpsCap: number;
}

/** Live flight context the AR layout needs, read at draw time (not per frame
 * through React). */
export interface FlightContext {
  mission: MissionState | null;
  avoid: AvoidState | null;
  showLoaded: boolean;
}

/** Draw-time statistics for the performance gate. */
export interface LayerPerf {
  draws: number;
  skipped: number;
  /** Last 512 draw durations, ms. */
  samples: Float64Array;
  cursor: number;
}

interface GridScratch {
  near: Uint8Array;
  measured: Uint8Array;
}

/** Per-kind layout state: the frame and rect the ops were laid out for. */
interface Laid {
  frame: unknown;
  prevFrame: unknown;
  key: string;
}

export class LayerEngine {
  readonly perf: LayerPerf = { draws: 0, skipped: 0, samples: new Float64Array(512), cursor: 0 };

  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  /** Natural size of the video frame, for the letterbox rect. */
  private videoW = 0;
  private videoH = 0;
  private opts: LayerOptions | null = null;
  private style: TargetStyle | null = null;
  private targets: TargetScene | null = null;
  private flight: () => FlightContext;

  private raf = 0;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastDrawAt = 0;
  private dirty = true;
  private running = false;
  private unsubscribe: (() => void) | null = null;

  private readonly arPrev = new DrawOpBuffer();
  private readonly arNext = new DrawOpBuffer();
  private readonly arOut = new DrawOpBuffer();
  private readonly obs = new DrawOpBuffer();
  private readonly depth = new DrawOpBuffer();
  private readonly zones = new DrawOpBuffer();
  private readonly chips = new DrawOpBuffer();
  private readonly gridScratch: GridScratch = { near: new Uint8Array(576), measured: new Uint8Array(72) };
  private laidAr: Laid = { frame: null, prevFrame: null, key: "" };
  private laidObs: Laid = { frame: null, prevFrame: null, key: "" };
  private laidDepth: Laid = { frame: null, prevFrame: null, key: "" };
  private laidZones: Laid = { frame: null, prevFrame: null, key: "" };

  constructor(flight: () => FlightContext) {
    this.flight = flight;
  }

  attach(canvas: HTMLCanvasElement): void {
    this.ctx = canvas.getContext("2d");
    this.unsubscribe = subscribeFrames(() => this.invalidate());
    this.running = true;
    this.invalidate();
  }

  detach(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.staleTimer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ctx = null;
  }

  /** Pause (page hidden) or resume the loop. */
  setRunning(on: boolean): void {
    this.running = on;
    if (on) this.invalidate();
    else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      clearTimeout(this.staleTimer);
    }
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    if (cssW === this.cssW && cssH === this.cssH && dpr === this.dpr) return;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    const c = this.ctx?.canvas;
    if (c) {
      c.width = Math.max(1, Math.round(cssW * dpr));
      c.height = Math.max(1, Math.round(cssH * dpr));
    }
    this.relayout();
  }

  setVideoSize(w: number, h: number): void {
    if (w === this.videoW && h === this.videoH) return;
    this.videoW = w;
    this.videoH = h;
    this.relayout();
  }

  setOptions(opts: LayerOptions): void {
    this.opts = opts;
    this.relayout();
  }

  setStyle(style: TargetStyle): void {
    this.style = style;
    this.invalidate();
  }

  setTargets(scene: TargetScene | null): void {
    this.targets = scene;
    this.invalidate();
  }

  /** Something the layouts depend on changed: lay out again on the next draw. */
  private relayout(): void {
    this.laidAr.key = "";
    this.laidObs.key = "";
    this.laidDepth.key = "";
    this.laidZones.key = "";
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (!this.running || this.raf !== 0 || !this.ctx) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number): void {
    this.raf = 0;
    if (!this.running) return;
    const cap = this.opts?.fpsCap ?? 0;
    if (cap > 0 && t - this.lastDrawAt < 1000 / cap - 1) {
      this.schedule();
      return;
    }
    if (!this.dirty) {
      this.perf.skipped += 1;
      return;
    }
    this.lastDrawAt = t;
    const t0 = performance.now();
    const animating = this.draw(Date.now());
    const dt = performance.now() - t0;
    const p = this.perf;
    p.draws += 1;
    p.samples[p.cursor] = dt;
    p.cursor = (p.cursor + 1) % p.samples.length;
    this.dirty = animating;
    if (animating) this.schedule();
  }

  /** The letterboxed video rect in CSS px. */
  private rect(fallbackW: number, fallbackH: number): Rect {
    const w = this.videoW || fallbackW;
    const h = this.videoH || fallbackH;
    return containRect(this.cssW, this.cssH, w || 16, h || 9);
  }

  /** Staleness of a slot: 0 fresh, 1 dimmed, 2 hidden. Arms a timer for the
   * next boundary so a stalled feed still dims and hides on time. */
  private age(slot: FrameSlot<unknown> | null, now: number, nextBoundary: { at: number }): 0 | 1 | 2 {
    if (!slot) return 2;
    const a = now - slot.receivedAt;
    if (a < LAYER_DIM_MS) {
      nextBoundary.at = Math.min(nextBoundary.at, slot.receivedAt + LAYER_DIM_MS);
      return 0;
    }
    if (a < LAYER_HIDE_MS) {
      nextBoundary.at = Math.min(nextBoundary.at, slot.receivedAt + LAYER_HIDE_MS);
      return 1;
    }
    return 2;
  }

  private grid(g: CameraGrid): { cols: number; rows: number; near: Uint8Array; measured: Uint8Array | null } {
    const n = g.cols * g.rows;
    const s = this.gridScratch;
    if (s.near.length < n) s.near = new Uint8Array(n);
    if (s.measured.length < Math.ceil(n / 8)) s.measured = new Uint8Array(Math.ceil(n / 8));
    decodeBase64Into(g.near, s.near);
    let measured: Uint8Array | null = null;
    if (g.measured) {
      decodeBase64Into(g.measured, s.measured);
      measured = s.measured;
    }
    return { cols: g.cols, rows: g.rows, near: s.near, measured };
  }

  /** Draw everything; true while an animation needs the next frame. */
  draw(now: number): boolean {
    const ctx = this.ctx;
    const o = this.opts;
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!o || this.cssW <= 0 || this.cssH <= 0) return false;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    let animating = false;
    const boundary = { at: Infinity };
    const frames = getFrames(o.droneId);
    const cam = o.cameraId;
    const on = o.layers;
    this.chips.clear();
    let chipY = 0;
    const chip = (k: string, text: string) => {
      const c = this.chips.push(k, "chip");
      c.text = text;
      c.color = "#E5E7EB";
      c.align = "left";
      c.x = 12;
      c.y = 0;
      chipY += 1;
      c.y = 18 + (chipY - 1) * 24;
    };

    // ── targets (detections, marks, lead) ──
    if (on.has("targets") && this.targets && this.style) {
      if (drawTargets(ctx, this.targets, this.style, now)) animating = true;
    }

    // ── AR route + motion ──
    const wantRoute = on.has("ar_route");
    const wantMotion = on.has("ar_motion");
    if ((wantRoute || wantMotion) && o.level !== "off") {
      const slot = frames.ar;
      const st = this.age(slot, now, boundary);
      const arCam: ArCamera | undefined = slot?.frame.cameras[cam];
      if (st < 2 && slot && arCam) {
        const rect = this.rect(arCam.frameW, arCam.frameH);
        const f = this.flight();
        const lopts = {
          level: o.level,
          groups: { route: wantRoute, motion: wantMotion },
          mission: slot.frame.mission ?? f.mission,
          avoid: f.avoid,
          showLoaded: f.showLoaded,
        };
        const key = `${rect.x},${rect.y},${rect.w},${rect.h},${o.level},${wantRoute},${wantMotion},${lopts.mission?.state ?? ""},${f.avoid ?? ""},${f.showLoaded}`;
        if (this.laidAr.frame !== slot.frame || this.laidAr.key !== key) {
          this.arNext.clear();
          layoutAr(arCam, rect, lopts, this.arNext);
          this.arPrev.clear();
          const prevCam = slot.prev?.cameras[cam];
          if (prevCam) layoutAr(prevCam, rect, lopts, this.arPrev);
          this.laidAr.frame = slot.frame;
          this.laidAr.key = key;
        }
        const interval = slot.prevAt !== null ? Math.max(16, slot.receivedAt - slot.prevAt) : DEFAULT_INTERVAL_MS;
        const since = now - slot.receivedAt;
        const tt = slot.prev ? Math.min(1, since / interval) : 1;
        const fade = slot.prev ? Math.min(1, since / FADE_MS) : 1;
        lerpOps(this.arPrev, this.arNext, tt, fade, this.arOut);
        if (tt < 1 || fade < 1) animating = true;
        ctx.globalAlpha = 1;
        if (st === 1) this.dimmed(ctx, () => paintOps(ctx, this.arOut));
        else paintOps(ctx, this.arOut);
        if (slot.frame.approx) chip("ar", "AR ≈");
        else if (slot.frame.reason !== null || arCam.reason !== null) chip("ar", "AR unavailable");
      } else if (slot && st === 2) {
        chip("ar", "AR unavailable");
      }
    }

    // ── obstacles ──
    if (on.has("obstacles")) {
      const slot = frames.obstacles;
      const st = this.age(slot, now, boundary);
      if (st < 2 && slot) {
        const g = slot.frame.cameras[cam];
        const rect = this.rect(0, 0);
        const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
        if (this.laidObs.frame !== slot.frame || this.laidObs.key !== key) {
          this.obs.clear();
          if (g) {
            const d = this.grid(g);
            layoutCells(d.near, d.measured, d.cols, d.rows, rect, { maxM: OBSTACLE_MAX_M, nearM: NEAR_M, mode: "solid" }, this.obs);
          }
          layoutSectorArc(slot.frame.sectorsM, rect, { maxM: OBSTACLE_MAX_M, nearM: NEAR_M }, this.obs);
          this.laidObs.frame = slot.frame;
          this.laidObs.key = key;
        }
        if (st === 1) this.dimmed(ctx, () => paintOps(ctx, this.obs));
        else paintOps(ctx, this.obs);
      } else if (slot) {
        chip("obstacles", "Obstacles unavailable");
      }
    }

    // ── depth ──
    if (on.has("depth") && o.depthRange !== "off") {
      const slot = frames.depth;
      const st = this.age(slot, now, boundary);
      if (st < 2 && slot) {
        const g = slot.frame.cameras[cam];
        const rect = this.rect(0, 0);
        const key = `${rect.x},${rect.y},${rect.w},${rect.h},${o.depthMode},${o.depthRange}`;
        if (this.laidDepth.frame !== slot.frame || this.laidDepth.key !== key) {
          this.depth.clear();
          if (g) {
            const d = this.grid(g);
            layoutCells(
              d.near,
              d.measured,
              d.cols,
              d.rows,
              rect,
              {
                maxM: o.depthRange === "2" ? 2 : 5,
                nearM: NEAR_M,
                mode: o.depthMode,
                unscaled: (g.scaleSource ?? slot.frame.scaleSource) === "none",
              },
              this.depth,
            );
          }
          this.laidDepth.frame = slot.frame;
          this.laidDepth.key = key;
        }
        if (st === 1) this.dimmed(ctx, () => paintOps(ctx, this.depth));
        else paintOps(ctx, this.depth);
        if (g && (g.scaleSource ?? slot.frame.scaleSource) === "none") chip("depth-unscaled", "Depth unscaled");
      } else {
        chip("depth", "Depth unavailable");
      }
    }

    // ── surfaces ──
    if (on.has("surfaces")) {
      const slot = frames.surfaces;
      const st = this.age(slot, now, boundary);
      if (st < 2 && slot && slot.frame.cameraId === cam) {
        const rect = this.rect(0, 0);
        const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
        if (this.laidZones.frame !== slot.frame || this.laidZones.key !== key) {
          this.zones.clear();
          layoutZones(slot.frame.zones, rect, this.zones);
          this.laidZones.frame = slot.frame;
          this.laidZones.key = key;
        }
        if (st === 1) this.dimmed(ctx, () => paintOps(ctx, this.zones));
        else paintOps(ctx, this.zones);
      } else {
        chip("surfaces", "Surfaces unavailable");
      }
    }

    if (this.chips.n > 0) paintOps(ctx, this.chips);

    clearTimeout(this.staleTimer);
    if (!animating && Number.isFinite(boundary.at)) {
      this.staleTimer = setTimeout(() => this.invalidate(), Math.max(0, boundary.at - Date.now()) + 1);
    }
    return animating;
  }

  private dimmed(ctx: CanvasRenderingContext2D, paint: () => void): void {
    // paintOps sets globalAlpha per op; draw the layer into a dimmed group.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = `opacity(${DIM_ALPHA})`;
    paint();
    ctx.restore();
  }
}
