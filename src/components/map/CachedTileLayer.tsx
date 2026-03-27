/**
 * @module CachedTileLayer
 * @description Leaflet TileLayer wrapper that caches tiles in IndexedDB.
 * On tile load, stores the blob. On request, checks cache first.
 * Falls back to network fetch when not cached.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { getCachedTile, cacheTile } from "@/lib/tile-cache";

const CACHE_TIMEOUT_MS = 2000;

interface CachedTileLayerProps {
  url: string;
  attribution?: string;
  maxZoom?: number;
}

/** Race a promise against a timeout. Resolves to null on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function loadDirect(tile: HTMLImageElement, tileUrl: string, done: (err?: Error | null, el?: HTMLElement) => void): void {
  tile.onload = () => done(null, tile);
  tile.onerror = () => done(new Error("Tile load error"), tile);
  tile.src = tileUrl;
}

function fetchAndCache(tile: HTMLImageElement, tileUrl: string, done: (err?: Error | null, el?: HTMLElement) => void): void {
  fetch(tileUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      cacheTile(tileUrl, blob).catch(() => {});
      const objectUrl = URL.createObjectURL(blob);
      tile.onload = () => {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        done(null, tile);
      };
      tile.src = objectUrl;
    })
    .catch(() => {
      loadDirect(tile, tileUrl, done);
    });
}

/** Subclass TileLayer to intercept tile loading with IndexedDB cache. */
class CachingTileLayer extends L.TileLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement("img") as HTMLImageElement;
    tile.alt = "";
    tile.crossOrigin = "anonymous";
    tile.setAttribute("role", "presentation");

    const tileUrl = this.getTileUrl(coords);

    const doneTyped = done as (err?: Error | null, el?: HTMLElement) => void;

    withTimeout(getCachedTile(tileUrl), CACHE_TIMEOUT_MS)
      .then((cachedBlob) => {
        if (cachedBlob) {
          const objectUrl = URL.createObjectURL(cachedBlob);
          tile.onload = () => {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            done(undefined, tile);
          };
          tile.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            fetchAndCache(tile, tileUrl, doneTyped);
          };
          tile.src = objectUrl;
        } else {
          fetchAndCache(tile, tileUrl, doneTyped);
        }
      })
      .catch(() => {
        loadDirect(tile, tileUrl, doneTyped);
      });

    return tile;
  }
}

export function CachedTileLayer({ url, attribution, maxZoom = 20 }: CachedTileLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const layer = new CachingTileLayer(url, {
      attribution: attribution ?? "",
      maxZoom,
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, url, attribution, maxZoom]);

  return null;
}
