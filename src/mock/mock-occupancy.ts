/**
 * @module mock/mock-occupancy
 * @description Synthetic occupancy tiles for the demo `map/live` feed. The
 * room from {@link module:mock/mock-nav-world} is rasterised into a 4×4 block
 * of 64×64-cell tiles at 0.05 m around the origin using map_server grey
 * values (0 occupied, 254 free, 205 unknown). PNG row 0 is the tile's max x
 * (north) and column 0 its min y (west), matching `tileFootprint`. Tiles are
 * revealed one per poll, nearest the origin first, with an increasing `seq`.
 * PNG encoding sits behind a {@link GreyPngEncoder} seam so tests can stub it.
 * @license GPL-3.0-only
 */

import type { OccupancyLive, OccupancyTileWire } from "@/lib/hud/nav-types";
import {
  PILLARS,
  ROOM_HALF_M,
  WALLS,
  WALL_HALF_THICKNESS_M,
  distanceToSegment,
} from "./mock-nav-world";

export const OCC_RES_M = 0.05;
export const OCC_TILE_CELLS = 64;
/** Tile indices on each axis: -2..1 covers -6.4..6.4 m. */
export const OCC_TILE_INDICES = [-2, -1, 0, 1] as const;

export const GREY_OCCUPIED = 0;
export const GREY_FREE = 254;
export const GREY_UNKNOWN = 205;

/** Grey value of the map cell centred at `(x, y)`. */
export function cellGrey(x: number, y: number): number {
  for (const p of PILLARS) {
    if (Math.hypot(x - p.x, y - p.y) <= p.r) return GREY_OCCUPIED;
  }
  for (const w of WALLS) {
    if (distanceToSegment(x, y, w) <= WALL_HALF_THICKNESS_M) return GREY_OCCUPIED;
  }
  return Math.abs(x) < ROOM_HALF_M && Math.abs(y) < ROOM_HALF_M ? GREY_FREE : GREY_UNKNOWN;
}

/** One tile's grey raster, row-major, `OCC_TILE_CELLS²` bytes. */
export function tileGrey(ix: number, iy: number): Uint8Array {
  const n = OCC_TILE_CELLS;
  const size = n * OCC_RES_M;
  const out = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    const x = (ix + 1) * size - (r + 0.5) * OCC_RES_M;
    for (let c = 0; c < n; c++) {
      out[r * n + c] = cellGrey(x, iy * size + (c + 0.5) * OCC_RES_M);
    }
  }
  return out;
}

/** Every demo tile, nearest the origin first (ties by ix, then iy). */
export function tileRevealOrder(): Array<[number, number]> {
  const half = (OCC_TILE_CELLS * OCC_RES_M) / 2;
  const tiles: Array<[number, number]> = [];
  for (const ix of OCC_TILE_INDICES) for (const iy of OCC_TILE_INDICES) tiles.push([ix, iy]);
  const centreDist = ([ix, iy]: [number, number]) =>
    Math.hypot(ix * 2 * half + half, iy * 2 * half + half);
  return tiles.sort((a, b) => centreDist(a) - centreDist(b) || a[0] - b[0] || a[1] - b[1]);
}

/** Encode a grey raster as base64 PNG (no data-URL prefix), or null when the
 * environment cannot encode. */
export type GreyPngEncoder = (grey: Uint8Array, width: number, height: number) => string | null;

const DATA_URL_PREFIX = "data:image/png;base64,";

/** Browser encoder: draws the raster on a canvas and reads it back as PNG. */
export const canvasGreyPngEncoder: GreyPngEncoder = (grey, width, height) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < grey.length; i++) {
    img.data[i * 4] = grey[i];
    img.data[i * 4 + 1] = grey[i];
    img.data[i * 4 + 2] = grey[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  return url.startsWith(DATA_URL_PREFIX) ? url.slice(DATA_URL_PREFIX.length) : null;
};

/**
 * Progressive tile reveal. Each {@link next} call is one `map/live` poll: it
 * adds the next tile (bumping `seq`) until every tile is out, then answers
 * with no tiles at the same `seq`, as an idle agent does.
 */
export class OccupancyReveal {
  private seq = 0;
  private revealed = 0;
  private readonly order = tileRevealOrder();

  constructor(private readonly encode: GreyPngEncoder = canvasGreyPngEncoder) {}

  /** Tiles revealed so far. */
  get revealedCount(): number {
    return this.revealed;
  }

  get totalCount(): number {
    return this.order.length;
  }

  next(): OccupancyLive {
    const tiles: OccupancyTileWire[] = [];
    if (this.revealed < this.order.length) {
      const [ix, iy] = this.order[this.revealed];
      const pngB64 = this.encode(tileGrey(ix, iy), OCC_TILE_CELLS, OCC_TILE_CELLS);
      if (pngB64 !== null) {
        tiles.push({ ix, iy, pngB64 });
        this.revealed++;
        this.seq++;
      }
    }
    return { seq: this.seq, frame: "map_ned", resM: OCC_RES_M, tileCells: OCC_TILE_CELLS, tiles };
  }
}
