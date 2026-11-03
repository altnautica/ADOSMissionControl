/**
 * @module mock/mock-live-world
 * @description Demo stand-in for the world-engine extension's drone Agent
 * page `live-world` (the live 3D viewer). The extension ships its viewer as a
 * bundle demo mode cannot load, so the demo mounts an in-memory inline module
 * in its place: the demo occupancy grid through the shared local-frame map,
 * plus a point cloud sampled from the synthetic room the demo drone flies in,
 * both labelled as demo data. The React panel is imported on mount only, so
 * it lands in the chunk a demo session opens.
 * @license GPL-3.0-only
 */

import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import { slotToCapability } from "@/lib/plugins/types";
import { PILLARS, WALLS, ROOM_HALF_M } from "./mock-nav-world";
import { DEMO_CAPTURE_PLUGIN_ID, LIVE_WORLD_PAGE } from "./mock-visor-surfaces";

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

/** The inline module the demo mounts in place of the extension's viewer. */
export const DEMO_LIVE_WORLD_MODULE: InlinePluginModule = {
  async mount(root, host) {
    // Lazy: the contribution producer imports this file on every route; the
    // viewer (and its canvas/map code) belongs only in a demo session's chunk.
    const { mountLiveWorldDemoPanel } = await import("./live-world-demo-panel");
    return mountLiveWorldDemoPanel(root, host);
  },
};

/** The demo `live-world` page body, built once so a re-render hands the host
 * the same bundle and the mounted viewer is not rebuilt. */
export const DEMO_LIVE_WORLD_CONTRIBUTION: {
  entry: typeof LIVE_WORLD_PAGE;
  contribution: PluginSlotContribution & { slot: "node.agent.page" };
} = {
  entry: LIVE_WORLD_PAGE,
  contribution: {
    slot: "node.agent.page",
    pluginId: DEMO_CAPTURE_PLUGIN_ID,
    panelId: LIVE_WORLD_PAGE.panelId,
    title: LIVE_WORLD_PAGE.title ?? "Live World",
    bundleUrl: "",
    isolation: "inline",
    inline: {
      status: "ready",
      bundle: {
        kind: "inline",
        module: DEMO_LIVE_WORLD_MODULE,
        trust: {
          pluginId: DEMO_CAPTURE_PLUGIN_ID,
          version: "0.0.0-demo",
          signerId: "demo",
          entrypoint: "gcs/plugin.bundle.js",
          paths: [],
        },
        readAsset: () => Promise.reject(new Error("the demo viewer ships no assets")),
      },
    },
    grantedCapabilities: new Set([slotToCapability("node.agent.page")]),
    handlers: {},
    pluginInstallId: DEMO_CAPTURE_PLUGIN_ID,
  },
};
