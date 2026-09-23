/**
 * KML overlay store.
 *
 * Manages display-only KML/KMZ overlays on the planner map.
 * Overlays are separate from mission waypoints and exist purely
 * for visual reference (no-fly zones, survey boundaries, etc.).
 *
 * @module overlay-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ── Types ────────────────────────────────────────────────────

export interface KmlOverlayStyle {
  lineColor: string;   // CSS hex (#RRGGBB)
  fillColor: string;
  lineWidth: number;
}

export interface KmlOverlay {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;      // 0-1
  /** Polygons as [lat, lon][] arrays. */
  polygons: [number, number][][];
  /** Polyline paths as [lat, lon][] arrays. */
  paths: [number, number][][];
  /** Point markers as [lat, lon] tuples. */
  points: [number, number][];
  /** Style extracted from KML or default. */
  style: KmlOverlayStyle;
}

interface OverlayStoreState {
  overlays: KmlOverlay[];
  addOverlay: (overlay: KmlOverlay) => void;
  removeOverlay: (id: string) => void;
  toggleVisibility: (id: string) => void;
  setOpacity: (id: string, opacity: number) => void;
  clearAll: () => void;
}

// ── Store ────────────────────────────────────────────────────

/** Keep only well-formed overlays from a persisted value, parsed geometry only. */
function sanitizeOverlays(value: unknown): KmlOverlay[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((o): o is KmlOverlay =>
      typeof o === "object" && o !== null
      && typeof (o as KmlOverlay).id === "string"
      && Array.isArray((o as KmlOverlay).polygons)
      && Array.isArray((o as KmlOverlay).paths)
      && Array.isArray((o as KmlOverlay).points)
      && typeof (o as KmlOverlay).style === "object")
    .map(({ id, name, visible, opacity, polygons, paths, points, style }) => ({
      id, name, visible, opacity, polygons, paths, points, style,
    }));
}

export const useOverlayStore = create<OverlayStoreState>()(
  persist(
    (set) => ({
      overlays: [],

      addOverlay: (overlay) => set((s) => ({ overlays: [...s.overlays, overlay] })),

      removeOverlay: (id) => set((s) => ({ overlays: s.overlays.filter((o) => o.id !== id) })),

      toggleVisibility: (id) => set((s) => ({
        overlays: s.overlays.map((o) => (o.id === id ? { ...o, visible: !o.visible } : o)),
      })),

      setOpacity: (id, opacity) => set((s) => ({
        overlays: s.overlays.map((o) => (o.id === id ? { ...o, opacity } : o)),
      })),

      clearAll: () => set({ overlays: [] }),
    }),
    {
      name: "altcmd:kml-overlays",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ overlays: s.overlays }),
      // Version 0 was a bare overlay array that also carried the raw KML text;
      // it does not survive, and any shape that is not an overlay list resets.
      migrate: (persisted) => ({
        overlays: sanitizeOverlays((persisted as { overlays?: unknown } | undefined)?.overlays),
      }),
    },
  ),
);
