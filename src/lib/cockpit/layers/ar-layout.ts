/**
 * @module hud/ar-layout
 * @description Lays out one camera's `ar` frame (projected route and motion
 * items, computed on the agent) into draw ops over the rendered video rect.
 * Pure apart from writing into the caller's reusable `DrawOpBuffer`.
 *
 * Drawing rules (identical on every surface):
 * - marker size 24 + 40·size px; next waypoint a solid triangle with its
 *   number, a tether to its ground point and a `WP4 · 120 m · 0:42` chip;
 *   `after` a dashed triangle; `other` 6 px dots at 40 % (Full level only);
 * - legs: active 6 px at 35 % plus a 2 px centre line in route colour; next
 *   2 px white; future 1.5 px dashed white fading 100→30 % (Full only);
 * - home a yellow "H" pad; fpv a winged 18 px circle; fpath cyan dashed with
 *   point dots (amber on detour, a red ✕ at the drone when blocked); orbit a
 *   cyan polyline with 3 direction chevrons; edge a 20 px arrow 16 px inside
 *   the rect with its distance.
 *
 * Mission state (agent-computed) changes the route: active draws as above;
 * paused greys and dashes the legs and hollows the next gate; loaded is a
 * white dashed preview (only when the caller allows it); returning hides the
 * route and emphasises home; complete hides the route; none draws no
 * mission items.
 *
 * Dependency-free apart from its siblings: Mission Control copies it.
 *
 * @license GPL-3.0-only
 */

import type { ArCamera, AvoidState, MissionState } from "./cockpit-frames";
import { DrawOpBuffer, LAYER_COLORS, type Rect } from "./layer-layout";

export type LayerLevel = "full" | "route" | "off";

export interface ArLayoutOptions {
  level: LayerLevel;
  /** `ar_route` (wp, leg, home, edge) and `ar_motion` (fpv, fpath, fgoal, orbit). */
  groups: { route: boolean; motion: boolean };
  mission: MissionState | null;
  /** Pilot avoid state; overrides an fpath item's own state when set. */
  avoid: AvoidState | null;
  /** A `loaded` mission previews only while disarmed or owner ∈ {pilot, fc_mode}. */
  showLoaded: boolean;
}

const MARKER_BASE_PX = 24;
const MARKER_SCALE_PX = 40;
const FPV_PX = 18;
const EDGE_ARROW_PX = 20;
const EDGE_INSET_PX = 16;

function fmtEta(s: number): string {
  const t = Math.max(0, Math.round(s));
  const m = Math.floor(t / 60);
  const ss = t % 60;
  return `${m}:${ss < 10 ? "0" : ""}${ss}`;
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function layoutAr(cam: ArCamera, rect: Rect, opts: ArLayoutOptions, out: DrawOpBuffer): void {
  if (opts.level === "off") return;
  const full = opts.level === "full";
  const ms = opts.mission?.state ?? null;
  const routeHidden = ms === "none" || ms === "complete" || ms === "returning" || (ms === "loaded" && !opts.showLoaded);
  const paused = ms === "paused";
  const preview = ms === "loaded";
  const returning = ms === "returning";
  const px = (x: number) => rect.x + x * rect.w;
  const py = (y: number) => rect.y + y * rect.h;

  for (const it of cam.items) {
    switch (it.t) {
      case "leg": {
        if (!opts.groups.route || routeHidden) break;
        if (it.role === "future" && !full) break;
        const grey = paused || preview;
        const color = paused ? LAYER_COLORS.paused : preview ? LAYER_COLORS.future : null;
        if (it.role === "active" && !grey) {
          const band = out.push(`${it.k}#band`, "line");
          band.color = LAYER_COLORS.route;
          band.alpha = 0.35;
          band.width = 6;
          band.halo = false;
          for (const [x, y] of it.pts) DrawOpBuffer.addPt(band, px(x), py(y));
          const centre = out.push(it.k, "line");
          centre.color = LAYER_COLORS.route;
          centre.width = 2;
          for (const [x, y] of it.pts) DrawOpBuffer.addPt(centre, px(x), py(y));
        } else if (it.role === "future") {
          // Fade 100→30 % along the polyline: one op per segment.
          const segs = it.pts.length - 1;
          for (let s = 0; s < segs; s++) {
            const op = out.push(`${it.k}#${s}`, "line");
            op.color = color ?? LAYER_COLORS.future;
            op.alpha = 0.8 * (1 - (0.7 * s) / Math.max(1, segs - 1));
            op.width = 1.5;
            op.dash = 6;
            DrawOpBuffer.addPt(op, px(it.pts[s][0]), py(it.pts[s][1]));
            DrawOpBuffer.addPt(op, px(it.pts[s + 1][0]), py(it.pts[s + 1][1]));
          }
        } else {
          const op = out.push(it.k, "line");
          op.color = color ?? LAYER_COLORS.future;
          op.width = 2;
          op.dash = grey ? 8 : 0;
          for (const [x, y] of it.pts) DrawOpBuffer.addPt(op, px(x), py(y));
        }
        break;
      }
      case "wp": {
        if (!opts.groups.route || routeHidden) break;
        if (it.role === "other") {
          if (!full) break;
          const dot = out.push(it.k, "circle");
          dot.x = px(it.x);
          dot.y = py(it.y);
          dot.r = 3;
          dot.color = LAYER_COLORS.route;
          dot.fill = LAYER_COLORS.route;
          dot.fillAlpha = 0.4;
          dot.alpha = 0.4;
          break;
        }
        const color = paused ? LAYER_COLORS.paused : preview ? LAYER_COLORS.future : LAYER_COLORS.route;
        const size = MARKER_BASE_PX + MARKER_SCALE_PX * Math.min(1, Math.max(0, it.size));
        const x = px(it.x);
        const y = py(it.y);
        if (it.role === "next" && it.gx !== null && it.gy !== null) {
          const tether = out.push(`${it.k}#tether`, "line");
          tether.color = color;
          tether.width = 1.5;
          tether.dash = 4;
          DrawOpBuffer.addPt(tether, x, y);
          DrawOpBuffer.addPt(tether, px(it.gx), py(it.gy));
        }
        const tri = out.push(it.k, "tri");
        tri.x = x;
        tri.y = y;
        tri.r = size;
        tri.color = color;
        tri.width = 2;
        const solid = it.role === "next" && !paused && !preview;
        tri.fill = solid ? color : null;
        tri.fillAlpha = 0.9;
        tri.dash = it.role === "after" || preview ? 5 : 0;
        const num = out.push(`${it.k}#n`, "text");
        num.x = x;
        num.y = y - size * 0.62;
        num.text = String(it.seq);
        num.color = solid ? "#000000" : color;
        num.halo = !solid;
        if (it.role === "next") {
          const parts = [`WP${it.seq}`];
          if (it.distM !== null) parts.push(fmtDist(it.distM));
          if (it.etaS !== null && ms === "active") parts.push(fmtEta(it.etaS));
          const chip = out.push(`${it.k}#chip`, "chip");
          chip.x = x;
          chip.y = y - size - 14;
          chip.text = parts.join(" · ");
          chip.color = color;
        }
        break;
      }
      case "home": {
        if (!opts.groups.route) break;
        const pad = out.push(it.k, "pad");
        pad.x = px(it.x);
        pad.y = py(it.y);
        pad.r = returning ? 18 : 12;
        pad.color = LAYER_COLORS.home;
        pad.width = returning ? 3 : 2;
        if (returning && it.distM !== null) {
          const chip = out.push(`${it.k}#chip`, "chip");
          chip.x = pad.x;
          chip.y = pad.y - pad.r - 14;
          chip.text = `H · ${fmtDist(it.distM)}`;
          chip.color = LAYER_COLORS.home;
        }
        break;
      }
      case "edge": {
        if (!opts.groups.route) break;
        if (it.of === "wp" && routeHidden) break;
        // Arrow on the rect inset by EDGE_INSET_PX, along `ang` from centre.
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const hw = rect.w / 2 - EDGE_INSET_PX - EDGE_ARROW_PX / 2;
        const hh = rect.h / 2 - EDGE_INSET_PX - EDGE_ARROW_PX / 2;
        const c = Math.cos(it.ang);
        const s = Math.sin(it.ang);
        const scale = Math.min(Math.abs(c) > 1e-6 ? hw / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? hh / Math.abs(s) : Infinity);
        const color = it.of === "home" ? LAYER_COLORS.home : LAYER_COLORS.route;
        const arrow = out.push(it.k, "arrow");
        arrow.x = cx + c * scale;
        arrow.y = cy + s * scale;
        arrow.r = EDGE_ARROW_PX / 2;
        arrow.ang = it.ang;
        arrow.color = color;
        arrow.fill = color;
        arrow.width = 1.5;
        const label = it.of === "home" ? "H" : `WP${it.seq ?? ""}`;
        const chip = out.push(`${it.k}#chip`, "chip");
        chip.x = arrow.x - c * (EDGE_ARROW_PX + 22);
        chip.y = arrow.y - s * (EDGE_ARROW_PX + 8);
        chip.text = it.distM !== null ? `${label} ${fmtDist(it.distM)}` : label;
        chip.color = color;
        break;
      }
      case "fpv": {
        if (!opts.groups.motion) break;
        const op = out.push(it.k, "fpv");
        op.x = px(it.x);
        op.y = py(it.y);
        op.r = FPV_PX / 2;
        op.color = LAYER_COLORS.future;
        op.width = 2;
        if (opts.avoid === "blocked") {
          const x = out.push("fpv#blocked", "cross");
          x.x = op.x;
          x.y = op.y;
          x.r = 10;
          x.width = 3;
          x.color = LAYER_COLORS.blocked;
        }
        break;
      }
      case "fpath": {
        if (!opts.groups.motion) break;
        const state = opts.avoid ?? it.state;
        const color = state === "detour" ? LAYER_COLORS.detour : state === "blocked" ? LAYER_COLORS.blocked : LAYER_COLORS.follow;
        const op = out.push(it.k, "line");
        op.color = color;
        op.width = 2;
        op.dash = 7;
        for (const [x, y] of it.pts) DrawOpBuffer.addPt(op, px(x), py(y));
        for (let i = 1; i < it.pts.length; i++) {
          const d = out.push(`${it.k}#d${i}`, "circle");
          d.x = px(it.pts[i][0]);
          d.y = py(it.pts[i][1]);
          d.r = 2.5;
          d.color = color;
          d.fill = color;
        }
        break;
      }
      case "fgoal": {
        if (!opts.groups.motion) break;
        const op = out.push(it.k, "circle");
        op.x = px(it.x);
        op.y = py(it.y);
        op.r = 7;
        op.color = LAYER_COLORS.follow;
        op.width = 2;
        break;
      }
      case "orbit": {
        if (!opts.groups.motion) break;
        const op = out.push(it.k, "line");
        op.color = LAYER_COLORS.follow;
        op.width = 2;
        op.closed = it.pts.length > 2;
        for (const [x, y] of it.pts) DrawOpBuffer.addPt(op, px(x), py(y));
        // Three chevrons evenly along the polyline, pointing along travel.
        const n = it.pts.length;
        const step = it.dir === "ccw" ? -1 : 1;
        for (let c = 0; c < 3; c++) {
          const i = Math.floor((c * n) / 3) % n;
          const j = (((i + step) % n) + n) % n;
          if (i === j) continue;
          const [x0, y0] = it.pts[i];
          const [x1, y1] = it.pts[j];
          const ch = out.push(`${it.k}#c${c}`, "chevron");
          ch.x = px((x0 + x1) / 2);
          ch.y = py((y0 + y1) / 2);
          ch.ang = Math.atan2(py(y1) - py(y0), px(x1) - px(x0));
          ch.r = 6;
          ch.width = 2;
          ch.color = LAYER_COLORS.follow;
        }
        break;
      }
    }
  }
}

/** The frame-level AR chip: "AR ≈" when approximate, "AR unavailable" when
 *  stale, absent for this camera, or the agent gave a reason; else null. */
export function arStatusChip(
  frame: { approx: boolean; reason: string | null } | null,
  cam: ArCamera | null,
  stale: boolean,
): "AR ≈" | "AR unavailable" | null {
  if (!frame || !cam || stale || frame.reason !== null || cam.reason !== null) return "AR unavailable";
  return frame.approx ? "AR ≈" : null;
}
