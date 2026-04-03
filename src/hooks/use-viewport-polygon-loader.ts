/**
 * @module use-viewport-polygon-loader
 * @description Hook that progressively loads real polygon airspace boundaries
 * from OpenAIP and FAA ArcGIS based on the current CesiumJS camera viewport.
 * Replaces circle approximations with actual irregular polygon zones as the
 * user pans and zooms across the globe.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useCallback } from "react";
import { Cartographic, Math as CesiumMath, type Viewer as CesiumViewer } from "cesium";
import { useAirspaceStore } from "@/stores/airspace-store";
import { fetchOpenAIPAirspaces } from "@/lib/airspace/openaip-provider";
import { fetchFaaAirspace } from "@/lib/airspace/faa-arcgis-provider";
import type { BoundingBox } from "@/lib/airspace/types";

/** Country codes grouped by approximate geographic region with bbox. */
const OPENAIP_REGIONS: { bbox: BoundingBox; countries: string[] }[] = [
  {
    bbox: { south: 34, north: 72, west: -12, east: 45 },
    countries: ["GB", "DE", "FR", "ES", "IT", "NL", "BE", "AT", "CH", "SE",
      "NO", "DK", "FI", "PL", "CZ", "HU", "RO", "PT", "IE", "GR",
      "HR", "BG", "SK", "SI", "LT", "LV", "EE"],
  },
  {
    bbox: { south: -56, north: 84, west: -141, east: -34 },
    countries: ["US", "CA", "BR", "MX", "AR", "CL", "CO"],
  },
  {
    bbox: { south: -11, north: 54, west: 68, east: 146 },
    countries: ["IN", "JP", "KR", "CN", "SG", "TH", "MY", "ID", "PH", "VN"],
  },
  {
    bbox: { south: -47, north: -8, west: 112, east: 179 },
    countries: ["AU", "NZ"],
  },
  {
    bbox: { south: -35, north: 42, west: -18, east: 60 },
    countries: ["AE", "SA", "IL", "ZA", "EG", "KE", "NG"],
  },
];

/** US bounding box for FAA ArcGIS polygon fetch. */
const US_BBOX: BoundingBox = { south: 24, north: 50, west: -125, east: -66 };

/** Camera altitude thresholds (meters). */
const MAX_ALT_FOR_POLYGONS = 2_000_000; // 2000 km — don't fetch when zoomed out further

function bboxOverlaps(a: BoundingBox, b: BoundingBox): boolean {
  return a.south <= b.north && a.north >= b.south && a.west <= b.east && a.east >= b.west;
}

/**
 * Progressively loads real polygon airspace data based on the camera viewport.
 * When the camera is zoomed in enough, determines which OpenAIP countries are
 * visible and fetches their polygon boundaries, merging them into the airspace store.
 */
export function useViewportPolygonLoader(
  viewer: CesiumViewer | null,
  openAipKey: string | null,
) {
  const fetchedCountriesRef = useRef(new Set<string>());
  const faaFetchedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadPolygons = useCallback(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const cartographic = Cartographic.fromCartesian(viewer.camera.positionWC);
    const cameraAlt = cartographic.height;

    // Too zoomed out — circles are fine
    if (cameraAlt > MAX_ALT_FOR_POLYGONS) return;

    const camLat = CesiumMath.toDegrees(cartographic.latitude);
    const camLon = CesiumMath.toDegrees(cartographic.longitude);

    // Estimate visible bbox from camera altitude
    const latSpan = Math.min(cameraAlt / 111_000, 40); // rough degrees visible
    const lonSpan = Math.min(cameraAlt / (111_000 * Math.cos(camLat * Math.PI / 180)), 60);
    const viewBbox: BoundingBox = {
      south: camLat - latSpan / 2,
      north: camLat + latSpan / 2,
      west: camLon - lonSpan / 2,
      east: camLon + lonSpan / 2,
    };

    const mergeZones = useAirspaceStore.getState().mergeZones;

    // Determine which OpenAIP countries overlap the viewport and haven't been fetched yet
    if (openAipKey) {
      const newCountries: string[] = [];
      for (const region of OPENAIP_REGIONS) {
        if (bboxOverlaps(viewBbox, region.bbox)) {
          for (const country of region.countries) {
            if (!fetchedCountriesRef.current.has(country)) {
              newCountries.push(country);
              fetchedCountriesRef.current.add(country); // Mark as in-flight to avoid dups
            }
          }
        }
      }

      if (newCountries.length > 0) {
        console.log(`[viewport-polygon] Fetching OpenAIP polygons for: ${newCountries.join(", ")}`);
        fetchOpenAIPAirspaces(newCountries, openAipKey)
          .then((zones) => {
            if (zones.length > 0) {
              console.log(`[viewport-polygon] Loaded ${zones.length} OpenAIP polygons`);
              mergeZones(zones);
            }
          })
          .catch((err) => {
            console.warn("[viewport-polygon] OpenAIP fetch failed:", err);
            // Remove failed countries so they can be retried on next pan
            for (const c of newCountries) fetchedCountriesRef.current.delete(c);
          });
      }
    }

    // FAA ArcGIS real polygons for US airspace
    if (!faaFetchedRef.current && bboxOverlaps(viewBbox, US_BBOX)) {
      faaFetchedRef.current = true;
      console.log("[viewport-polygon] Fetching FAA ArcGIS polygons for US airspace");
      fetchFaaAirspace(viewBbox)
        .then((zones) => {
          if (zones.length > 0) {
            console.log(`[viewport-polygon] Loaded ${zones.length} FAA polygons`);
            mergeZones(zones);
          }
        })
        .catch((err) => {
          console.warn("[viewport-polygon] FAA ArcGIS fetch failed:", err);
          faaFetchedRef.current = false; // Retry on next viewport change
        });
    }
  }, [viewer, openAipKey]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const handler = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(loadPolygons, 500);
    };

    viewer.camera.moveEnd.addEventListener(handler);

    // Trigger initial load after a short delay to let Convex circles render first
    const initialTimer = setTimeout(loadPolygons, 1000);

    const currentAbort = abortRef.current;
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.camera.moveEnd.removeEventListener(handler);
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearTimeout(initialTimer);
      if (currentAbort) currentAbort.abort();
    };
  }, [viewer, loadPolygons]);

  // Reset fetched tracking on key changes
  useEffect(() => {
    fetchedCountriesRef.current.clear();
    faaFetchedRef.current = false;
  }, [openAipKey]);
}
