/**
 * @module mock/mock-live-world
 * @description The demo page bodies for the world-engine extension. The
 * extension ships its pages as a bundle demo mode cannot load, so the demo
 * mounts an in-memory inline module in their place. The two pages that show
 * live data get a demo rendition of the real page: `world-model` holds the
 * live map (the demo occupancy grid through the shared local-frame map, plus
 * a point cloud sampled from the synthetic room the demo drone flies in) and
 * `live-world` is the capture monitor. Every other page shows a card that
 * names itself as a demo stand-in. The React panels are imported on mount
 * only, so they land in the chunk a demo session opens.
 * @license GPL-3.0-only
 */

import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import { PILLARS, WALLS, ROOM_HALF_M } from "./mock-nav-world";

/** One map-frame point (x north, y east, z up, metres) with its height band. */
export interface CloudPoint {
  x: number;
  y: number;
  z: number;
  /** Height band index, `floor(z / bandM)`. */
  band: number;
}

export const CLOUD_HEIGHT_M = 2.75;
export const CLOUD_BAND_M = 0.25;
const SURFACE_SPACING_M = 0.15;
const FLOOR_SPACING_M = 0.6;

/** Small deterministic scatter so the cloud does not look like a lattice. */
function scatter(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 0.04;
}

/**
 * A point cloud of the demo room: the walls and pillars sampled every 0.15 m
 * along their surface from the floor to 2.75 m, plus a sparse floor grid at
 * z = 0. Deterministic, so every mount shows the same scene.
 */
export function demoPointCloud(): CloudPoint[] {
  const out: CloudPoint[] = [];
  const heights: number[] = [];
  for (let z = 0; z <= CLOUD_HEIGHT_M + 1e-9; z += SURFACE_SPACING_M) heights.push(z);
  const column = (x: number, y: number) => {
    for (const z of heights) {
      const i = out.length;
      out.push({ x: x + scatter(i), y: y + scatter(i + 7), z, band: Math.floor(z / CLOUD_BAND_M) });
    }
  };
  for (const w of WALLS) {
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    const steps = Math.max(1, Math.round(len / SURFACE_SPACING_M));
    for (let s = 0; s <= steps; s++) {
      column(w.ax + ((w.bx - w.ax) * s) / steps, w.ay + ((w.by - w.ay) * s) / steps);
    }
  }
  for (const p of PILLARS) {
    const steps = Math.max(8, Math.round((2 * Math.PI * p.r) / SURFACE_SPACING_M));
    for (let s = 0; s < steps; s++) {
      const a = (2 * Math.PI * s) / steps;
      column(p.x + p.r * Math.cos(a), p.y + p.r * Math.sin(a));
    }
  }
  for (let x = -ROOM_HALF_M + FLOOR_SPACING_M; x < ROOM_HALF_M; x += FLOOR_SPACING_M) {
    for (let y = -ROOM_HALF_M + FLOOR_SPACING_M; y < ROOM_HALF_M; y += FLOOR_SPACING_M) {
      out.push({ x, y, z: 0, band: 0 });
    }
  }
  return out;
}

/** Pages whose demo body is a rendition of the real page. */
const RENDERED_PAGES: Readonly<Record<string, true>> = { "live-world": true, "world-model": true };

/** The inline module the demo mounts in place of every world-engine page. */
export const DEMO_LIVE_WORLD_MODULE: InlinePluginModule = {
  async mount(root, host) {
    if (RENDERED_PAGES[host.plugin?.panelId ?? "world-model"]) {
      // Lazy: the contribution producer imports this file on every route; the
      // panels (and their canvas/map code) belong only in a demo session's chunk.
      const { mountLiveWorldDemoPanel } = await import("./live-world-demo-panel");
      return mountLiveWorldDemoPanel(root, host);
    }
    const card = document.createElement("div");
    card.className =
      "m-3 rounded border border-border-default bg-bg-secondary p-3 text-xs text-text-secondary";
    card.textContent = `Demo stand-in: the world-engine extension's "${host.plugin.panelId}" page renders here on a node with the extension installed. Demo mode loads no extension bundle.`;
    root.append(card);
    return () => card.remove();
  },
};
