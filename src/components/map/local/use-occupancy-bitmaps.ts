"use client";

/**
 * @module map/local/use-occupancy-bitmaps
 * @description Decodes each live occupancy tile's PNG once into an offscreen
 * canvas, recoloured per pixel at decode (occupied ink 90 %, free ink 10 %,
 * unknown transparent), and keeps them in a module-wide LRU of 512 tiles so
 * the minimap and the Map tab share the work. A tile is decoded again only
 * when its PNG or the ink colour changes.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";

import { OCCUPANCY_TILE_LIMIT, type OccupancyGrid } from "@/lib/nav/local-frame";
import {
  FREE_ALPHA,
  OCCUPIED_ALPHA,
  recolourOccupancy,
  withAlpha,
  type Rgba,
} from "@/lib/nav/occupancy-bitmap";

interface CacheEntry {
  b64: string;
  inkKey: string;
  /** Null while the decode is in flight or after it failed. */
  image: HTMLCanvasElement | null;
}

const cache = new Map<string, CacheEntry>();

function remember(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > OCCUPANCY_TILE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function loadPng(b64: string): Promise<ImageBitmap | HTMLImageElement> {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type: "image/png" });
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeTile(b64: string, ink: Rgba): Promise<HTMLCanvasElement | null> {
  const source = await loadPng(b64);
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
  ctx.drawImage(source, 0, 0);
  if ("close" in source) source.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolourOccupancy(pixels.data, withAlpha(ink, OCCUPIED_ALPHA), withAlpha(ink, FREE_ALPHA));
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/**
 * Decoded, recoloured tiles for one drone's grid. `lookup(tileKey)` returns
 * the drawable once decoded; `version` changes whenever a decode lands, so a
 * painter that depends on it redraws.
 */
export function useOccupancyBitmaps(
  droneId: string,
  grid: OccupancyGrid,
  ink: Rgba | null,
): { lookup: (tileKey: string) => HTMLCanvasElement | null; version: number } {
  const [version, setVersion] = useState(0);
  const inkKey = ink ? ink.join(",") : "";

  useEffect(() => {
    if (!ink) return;
    for (const [tileKey, tile] of Object.entries(grid.tiles)) {
      const key = `${droneId}|${tileKey}`;
      const hit = cache.get(key);
      if (hit && hit.b64 === tile.pngB64 && hit.inkKey === inkKey) continue;
      const entry: CacheEntry = { b64: tile.pngB64, inkKey, image: null };
      remember(key, entry);
      decodeTile(tile.pngB64, ink)
        .then((image) => {
          entry.image = image;
          setVersion((v) => v + 1);
        })
        .catch(() => {
          // A tile that does not decode stays undrawn; the next PNG for it
          // replaces the entry.
        });
    }
    // `inkKey` stands for `ink` (a fresh array per resolve).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneId, grid.tiles, inkKey]);

  const lookup = useCallback(
    (tileKey: string) => {
      const key = `${droneId}|${tileKey}`;
      const hit = cache.get(key);
      if (!hit) return null;
      remember(key, hit);
      return hit.image;
    },
    [droneId],
  );

  return { lookup, version };
}
