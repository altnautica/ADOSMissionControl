/**
 * @module poi-store
 * @description Zustand store for Point of Interest markers on the flight map.
 * POIs are local-only markers with labels, persisted to localStorage.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export interface PoiMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  color: string;
  createdAt: number;
}

const STORAGE_KEY = "ados-poi-markers";

function loadFromStorage(): PoiMarker[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PoiMarker[];
  } catch {
    return [];
  }
}

function saveToStorage(markers: PoiMarker[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
  } catch { /* storage full, ignore */ }
}

interface PoiStoreState {
  markers: PoiMarker[];
  addMarker: (lat: number, lon: number, label: string) => void;
  removeMarker: (id: string) => void;
  updateMarker: (id: string, update: Partial<PoiMarker>) => void;
  clearAll: () => void;
}

export const usePoiStore = create<PoiStoreState>()((set) => ({
  markers: loadFromStorage(),

  addMarker: (lat, lon, label) =>
    set((s) => {
      const marker: PoiMarker = {
        id: `poi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        lat,
        lon,
        label: label || `POI ${s.markers.length + 1}`,
        color: "#DFF140",
        createdAt: Date.now(),
      };
      const next = [...s.markers, marker];
      saveToStorage(next);
      return { markers: next };
    }),

  removeMarker: (id) =>
    set((s) => {
      const next = s.markers.filter((m) => m.id !== id);
      saveToStorage(next);
      return { markers: next };
    }),

  updateMarker: (id, update) =>
    set((s) => {
      const next = s.markers.map((m) => (m.id === id ? { ...m, ...update } : m));
      saveToStorage(next);
      return { markers: next };
    }),

  clearAll: () => {
    saveToStorage([]);
    set({ markers: [] });
  },
}));
