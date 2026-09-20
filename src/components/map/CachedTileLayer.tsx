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
import { resolveTileUrl, subdomainsForUrl, isRetinaDisplay } from "@/lib/tile-math";
import { useTileHealthStore } from "@/stores/tile-health-store";

const CACHE_TIMEOUT_MS = 2000;

interface CachedTileLayerProps {
  url: string;
  attribution?: string;
  maxZoom?: number;
  /**
   * Request tiles with `crossOrigin="anonymous"`. Default true (every CDN
   * provider sends CORS, and the cache write needs a readable response).
   * False for an operator-supplied server that sends no CORS header.
   */
  crossOrigin?: boolean;
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
  private readonly templateUrl: string;
  private readonly useCrossOrigin: boolean;

  constructor(urlTemplate: string, useCrossOrigin: boolean, options?: L.TileLayerOptions) {
    super(urlTemplate, options);
    this.templateUrl = urlTemplate;
    this.useCrossOrigin = useCrossOrigin;
  }

  /**
   * Build the tile URL through the shared resolver so the request URL matches
   * the offline downloader's stored URL byte-for-byte (subdomain scheme + the
   * `@2x` retina variant). Leaflet's default templating used a 3-subdomain
   * `abc` scheme and its own `{r}` handling, which never matched the
   * downloader's key on HiDPI displays or 4-subdomain providers.
   */
  getTileUrl(coords: L.Coords): string {
    return resolveTileUrl(
      this.templateUrl,
      subdomainsForUrl(this.templateUrl),
      coords.x,
      coords.y,
      this._getZoomForUrl(),
      isRetinaDisplay(),
    );
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement("img") as HTMLImageElement;
    tile.alt = "";
    // Opt-out: a self-hosted tile server usually sends no CORS header, and an
    // `anonymous` <img> then fails to load at all — a fully blank map.
    if (this.useCrossOrigin) tile.crossOrigin = "anonymous";
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

export function CachedTileLayer({
  url,
  attribution,
  maxZoom = 20,
  crossOrigin = true,
}: CachedTileLayerProps) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const layer = new CachingTileLayer(url, crossOrigin, {
      attribution: attribution ?? "",
      maxZoom,
    });

    layer.addTo(map);
    layerRef.current = layer;

    // A self-hosted tile URL that 404s or is blocked paints nothing, which is
    // indistinguishable from empty imagery without these counters.
    useTileHealthStore.getState().observe(url);
    layer.on("tileload", () => useTileHealthStore.getState().recordLoad());
    layer.on("tileerror", (e) => {
      const tile = (e as L.TileEvent).tile as HTMLImageElement | undefined;
      useTileHealthStore.getState().recordError(tile?.src ?? null);
    });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, url, attribution, maxZoom, crossOrigin]);

  return null;
}
