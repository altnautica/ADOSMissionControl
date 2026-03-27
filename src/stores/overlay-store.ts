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
  /** Raw KML text for persistence. */
  rawKml: string;
}

interface OverlayStoreState {
  overlays: KmlOverlay[];
  addOverlay: (overlay: KmlOverlay) => void;
  removeOverlay: (id: string) => void;
  toggleVisibility: (id: string) => void;
  setOpacity: (id: string, opacity: number) => void;
  clearAll: () => void;
}

// ── Persistence ──────────────────────────────────────────────

const STORAGE_KEY = "altcmd:kml-overlays";

function loadFromStorage(): KmlOverlay[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupted data, ignore
  }
  return [];
}

function saveToStorage(overlays: KmlOverlay[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overlays));
  } catch {
    // quota exceeded, ignore
  }
}

// ── Store ────────────────────────────────────────────────────

export const useOverlayStore = create<OverlayStoreState>((set, get) => ({
  overlays: loadFromStorage(),

  addOverlay: (overlay) => {
    const next = [...get().overlays, overlay];
    saveToStorage(next);
    set({ overlays: next });
  },

  removeOverlay: (id) => {
    const next = get().overlays.filter((o) => o.id !== id);
    saveToStorage(next);
    set({ overlays: next });
  },

  toggleVisibility: (id) => {
    const next = get().overlays.map((o) =>
      o.id === id ? { ...o, visible: !o.visible } : o,
    );
    saveToStorage(next);
    set({ overlays: next });
  },

  setOpacity: (id, opacity) => {
    const next = get().overlays.map((o) =>
      o.id === id ? { ...o, opacity } : o,
    );
    saveToStorage(next);
    set({ overlays: next });
  },

  clearAll: () => {
    saveToStorage([]);
    set({ overlays: [] });
  },
}));
