/**
 * @module cockpit/layers/engine
 * @description The layer stack's draw loop, outside React. One canvas per
 * video, sized to the container at `devicePixelRatio`; every layer is drawn
 * into it in the cockpit spec's z-order: depth, surfaces, obstacles, targets
 * (detections, marks, lead), AR route and AR motion.
 *
 * The loop draws only when something changed: a new frame in the frame store,
 * a new target scene, a resize, a layer or level change, an interpolation or
 * fade still in progress, or a staleness boundary (dim at 500 ms, hide at 2 s).
 * With nothing changed it schedules nothing. It stops while the page is hidden.
 *
 * Interpolation: AR ops of the same key move linearly between the last two
 * frames over the measured inter-frame interval; ops new in a frame fade in
 * over 120 ms and removed ones fade out. Layouts are recomputed only when a
 * frame, the rect or the options change; between them only the blend runs.
 * Every buffer, rect and option object is owned by the engine and reused, so
 * a steady draw allocates nothing.
 *
 * @license GPL-3.0-only
 */

import { arStatusChip, layoutAr, type ArLayoutOptions } from "@/lib/hud/ar-layout";
import {
  decodeBase64Into,
  type ArCamera,
  type AvoidState,
  type CameraGrid,
} from "@/lib/hud/cockpit-frames";
import { drawTargets, type TargetScene, type TargetStyle } from "./draw-targets";
import { drawMarks } from "./draw-marks";
import { getFrames, subscribeFrames, type FrameSlot } from "./frame-store";
import {
  DrawOpBuffer,
  FADE_MS,
  layoutCells,
  layoutSectorArc,
  layoutZones,
  lerpOps,
  type CellOptions,
  type Rect,
} from "@/lib/hud/layer-layout";
import { paintOps } from "@/lib/hud/layer-paint";
import { LAYER_DIM_MS, LAYER_HIDE_MS } from "./layer-spec";
import cockpitTokens from "@/lib/cockpit/spec/tokens.json";
import {
  DEFAULT_CHIP_TEXT,
  type FlightContext,
  type GridScratch,
  type LayerChipText,
  type LayerOptions,
  type LayerPerf,
  type Laid,
} from "./engine-types";

const DIM_ALPHA = 0.45;
/** Obstacle cells drawn up to this range; red at or under the near limit. */
const OBSTACLE_MAX_M = 5;
const NEAR_M = 2;
/** Interpolation interval when only one frame has arrived. */
const DEFAULT_INTERVAL_MS = 100;
/** Interpolation interval bounds. The upper bound keeps a frame that follows a
 * keep-alive-only stretch from crawling over seconds. */
const MIN_INTERVAL_MS = 16;
const MAX_INTERVAL_MS = 250;
const CHIP_COLOR = cockpitTokens.layer.unavailable_chip;

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
  /** The shown detection batch's arrival, as a slot for {@link age}. */
  private readonly targetSlot = { receivedAt: 0 };
  private chipText: LayerChipText = DEFAULT_CHIP_TEXT;
  private readonly readFlight: (out: FlightContext) => void;
  private readonly flight: FlightContext = { mission: null, avoid: null, showLoaded: true };

  private raf = 0;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastDrawAt = 0;
  private dirty = true;
  private running = false;
  private unsubscribe: (() => void) | null = null;
  private readonly onFrame = (t: number) => this.frame(t);
  private readonly onStale = () => this.invalidate();

  private readonly arPrev = new DrawOpBuffer();
  private readonly arNext = new DrawOpBuffer();
  private readonly arOut = new DrawOpBuffer();
  private readonly obs = new DrawOpBuffer();
  private readonly depth = new DrawOpBuffer();
  private readonly zones = new DrawOpBuffer();
  private readonly chips = new DrawOpBuffer();
  private readonly grid: GridScratch = { near: new Uint8Array(576), measured: new Uint8Array(72), hasMeasured: false };
  private readonly rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly arOpts: ArLayoutOptions = {
    level: "full",
    groups: { route: true, motion: true },
    mission: null,
    avoid: null,
    showLoaded: true,
  };
  private readonly obsCells: CellOptions = { maxM: OBSTACLE_MAX_M, nearM: NEAR_M, mode: "solid" };
  private readonly obsArc = { maxM: OBSTACLE_MAX_M, nearM: NEAR_M };
  private readonly depthCells: CellOptions = { maxM: 5, nearM: NEAR_M, mode: "solid", unscaled: false };
  private readonly laidAr: Laid = { frame: null, valid: false };
  private readonly laidObs: Laid = { frame: null, valid: false };
  private readonly laidDepth: Laid = { frame: null, valid: false };
  private readonly laidZones: Laid = { frame: null, valid: false };
  /** AR layout inputs read at draw time; a change forces a new layout. */
  private arMission: string | null = null;
  private arAvoid: AvoidState | null = null;
  private arShowLoaded = true;
  private arFrameW = 0;
  private arFrameH = 0;
  /** Earliest staleness boundary seen in the current draw. */
  private nextBoundary = Infinity;
  private chipCount = 0;

  constructor(readFlight: (out: FlightContext) => void) {
    this.readFlight = readFlight;
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

  /** Localised chip text (set from the shell when the locale changes). */
  setChipText(text: LayerChipText): void {
    this.chipText = text;
    this.invalidate();
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
    this.laidAr.valid = false;
    this.laidObs.valid = false;
    this.laidDepth.valid = false;
    this.laidZones.valid = false;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (!this.running || this.raf !== 0 || !this.ctx) return;
    this.raf = requestAnimationFrame(this.onFrame);
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

  /** Lay the letterboxed (object-contain) video rect into `this.rect`. A
   * change marks every layout stale. */
  private layoutRect(fallbackW: number, fallbackH: number): void {
    const fw = this.videoW || fallbackW || 16;
    const fh = this.videoH || fallbackH || 9;
    const s = Math.min(this.cssW / fw, this.cssH / fh);
    const w = fw * s;
    const h = fh * s;
    const x = (this.cssW - w) / 2;
    const y = (this.cssH - h) / 2;
    const r = this.rect;
    if (r.x === x && r.y === y && r.w === w && r.h === h) return;
    r.x = x;
    r.y = y;
    r.w = w;
    r.h = h;
    this.laidAr.valid = false;
    this.laidObs.valid = false;
    this.laidDepth.valid = false;
    this.laidZones.valid = false;
  }

  /** Staleness of a slot: 0 fresh, 1 dimmed, 2 hidden. Records the next
   * boundary so a stalled feed still dims and hides on time. */
  private age(slot: { readonly receivedAt: number } | null, now: number): 0 | 1 | 2 {
    if (!slot) return 2;
    const a = now - slot.receivedAt;
    if (a < LAYER_DIM_MS) {
      this.nextBoundary = Math.min(this.nextBoundary, slot.receivedAt + LAYER_DIM_MS);
      return 0;
    }
    if (a < LAYER_HIDE_MS) {
      this.nextBoundary = Math.min(this.nextBoundary, slot.receivedAt + LAYER_HIDE_MS);
      return 1;
    }
    return 2;
  }

  /** Decode a per-camera grid into the reused buffers. */
  private decode(g: CameraGrid): void {
    const n = g.cols * g.rows;
    const s = this.grid;
    if (s.near.length < n) s.near = new Uint8Array(n);
    if (s.measured.length < Math.ceil(n / 8)) s.measured = new Uint8Array(Math.ceil(n / 8));
    decodeBase64Into(g.near, s.near);
    s.hasMeasured = g.measured !== null;
    if (g.measured !== null) decodeBase64Into(g.measured, s.measured);
  }

  /** Stack one status chip centred under the top chrome (a fifth down the
   * video rect, as the agent cockpit does); at the very top it sat behind
   * the top bar and never showed. */
  private chip(k: string, text: string): void {
    const c = this.chips.push(k, "chip");
    c.text = text;
    c.color = CHIP_COLOR;
    c.align = "center";
    c.x = this.rect.x + this.rect.w / 2;
    c.y = this.rect.y + this.rect.h * 0.2 + this.chipCount * 24;
    this.chipCount += 1;
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
    this.nextBoundary = Infinity;
    this.chips.clear();
    this.chipCount = 0;
    const frames = getFrames(o.droneId);
    const cam = o.cameraId;
    const on = o.layers;
    const arCam: ArCamera | undefined = frames.ar?.frame.cameras[cam];
    this.layoutRect(arCam?.frameW ?? 0, arCam?.frameH ?? 0);
    const rect = this.rect;

    // ── depth (z 10) ──
    if (on.has("depth") && o.depthRange !== "off") {
      const slot = frames.depth;
      const st = this.age(slot, now);
      const g = slot?.frame.cameras[cam];
      if (st < 2 && slot && g) {
        const unscaled = (g.scaleSource ?? slot.frame.scaleSource) === "none";
        if (this.laidDepth.frame !== slot.frame || !this.laidDepth.valid) {
          this.depth.clear();
          this.decode(g);
          const c = this.depthCells;
          c.maxM = o.depthRange === "2" ? 2 : 5;
          c.mode = o.depthMode;
          c.unscaled = unscaled;
          layoutCells(this.grid.near, this.grid.hasMeasured ? this.grid.measured : null, g.cols, g.rows, rect, c, this.depth);
          this.laidDepth.frame = slot.frame;
          this.laidDepth.valid = true;
        }
        paintOps(ctx, this.depth, st === 1 ? DIM_ALPHA : 1);
        if (unscaled) this.chip("depth-unscaled", this.chipText.depthUnscaled);
      } else {
        this.chip("depth", this.chipText.depthUnavailable);
      }
    }

    // ── surfaces (z 20) ──
    if (on.has("surfaces")) {
      const slot = frames.surfaces;
      const st = this.age(slot, now);
      if (st < 2 && slot && slot.frame.cameraId === cam) {
        if (this.laidZones.frame !== slot.frame || !this.laidZones.valid) {
          this.zones.clear();
          layoutZones(slot.frame.zones, rect, this.zones);
          this.laidZones.frame = slot.frame;
          this.laidZones.valid = true;
        }
        paintOps(ctx, this.zones, st === 1 ? DIM_ALPHA : 1);
      } else {
        this.chip("surfaces", this.chipText.surfacesUnavailable);
      }
    }

    // ── obstacles (z 30) ──
    if (on.has("obstacles")) {
      const slot = frames.obstacles;
      const st = this.age(slot, now);
      if (st < 2 && slot) {
        if (this.laidObs.frame !== slot.frame || !this.laidObs.valid) {
          this.obs.clear();
          const g = slot.frame.cameras[cam];
          if (g) {
            this.decode(g);
            layoutCells(this.grid.near, this.grid.hasMeasured ? this.grid.measured : null, g.cols, g.rows, rect, this.obsCells, this.obs);
          }
          layoutSectorArc(slot.frame.sectorsM, rect, this.obsArc, this.obs);
          this.laidObs.frame = slot.frame;
          this.laidObs.valid = true;
        }
        paintOps(ctx, this.obs, st === 1 ? DIM_ALPHA : 1);
      } else if (slot) {
        this.chip("obstacles", this.chipText.obstaclesUnavailable);
      }
    }

    // ── targets (z 40): detections and lead dim and hide on the detection
    // batch's age like every other layer; the cockpit marks do not depend on
    // detections and always draw. The unavailable chip shows only when a
    // detector exists and its batch has gone stale. ──
    if (on.has("targets") && this.targets && this.style) {
      const at = this.targets.batchAt;
      if (at !== null) this.targetSlot.receivedAt = at;
      const st = this.age(at === null ? null : this.targetSlot, now);
      if (st < 2) {
        const opacity = st === 1 ? DIM_ALPHA : 1;
        if (drawTargets(ctx, this.targets, this.style, now, this.cssW, this.cssH, opacity)) animating = true;
      } else {
        drawMarks(ctx, this.targets.marks, this.targets.markFrame, this.style, this.cssW, this.cssH);
        if (this.targets.detector) this.chip("targets", this.chipText.targetsUnavailable);
      }
    }

    // ── AR route (z 50) + motion (z 60) ──
    const wantRoute = on.has("ar_route");
    const wantMotion = on.has("ar_motion");
    if ((wantRoute || wantMotion) && o.level !== "off") {
      const slot = frames.ar;
      const st = this.age(slot, now);
      if (st < 2 && slot && arCam) {
        const f = this.flight;
        this.readFlight(f);
        const mission = slot.frame.mission ?? f.mission;
        const ms = mission?.state ?? null;
        if (
          ms !== this.arMission ||
          f.avoid !== this.arAvoid ||
          f.showLoaded !== this.arShowLoaded ||
          arCam.frameW !== this.arFrameW ||
          arCam.frameH !== this.arFrameH
        ) {
          this.arMission = ms;
          this.arAvoid = f.avoid;
          this.arShowLoaded = f.showLoaded;
          this.arFrameW = arCam.frameW;
          this.arFrameH = arCam.frameH;
          this.laidAr.valid = false;
        }
        if (this.laidAr.frame !== slot.frame || !this.laidAr.valid) {
          const lo = this.arOpts;
          lo.level = o.level;
          lo.groups.route = wantRoute;
          lo.groups.motion = wantMotion;
          lo.mission = mission;
          lo.avoid = f.avoid;
          lo.showLoaded = f.showLoaded;
          this.arNext.clear();
          layoutAr(arCam, rect, lo, this.arNext);
          this.arPrev.clear();
          const prevCam = slot.prev?.cameras[cam];
          if (prevCam) layoutAr(prevCam, rect, lo, this.arPrev);
          this.laidAr.frame = slot.frame;
          this.laidAr.valid = true;
        }
        const interval =
          slot.prevAt !== null
            ? Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, slot.frameAt - slot.prevAt))
            : DEFAULT_INTERVAL_MS;
        const since = now - slot.frameAt;
        const tt = slot.prev ? Math.min(1, since / interval) : 1;
        const fade = slot.prev ? Math.min(1, since / FADE_MS) : 1;
        lerpOps(this.arPrev, this.arNext, tt, fade, this.arOut);
        if (tt < 1 || fade < 1) animating = true;
        paintOps(ctx, this.arOut, st === 1 ? DIM_ALPHA : 1);
        const status = arStatusChip(slot.frame, arCam, false);
        if (status) this.chip("ar", status === "AR ≈" ? this.chipText.arApprox : this.chipText.arUnavailable);
      } else if (slot) {
        // Stale, or nothing for the camera on screen.
        this.chip("ar", this.chipText.arUnavailable);
      }
    }

    if (this.chips.n > 0) paintOps(ctx, this.chips);

    clearTimeout(this.staleTimer);
    if (!animating && Number.isFinite(this.nextBoundary)) {
      this.staleTimer = setTimeout(this.onStale, Math.max(0, this.nextBoundary - Date.now()) + 1);
    }
    return animating;
  }
}
