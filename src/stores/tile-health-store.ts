/**
 * Live tile load/error counters for the basemap layer currently mounted.
 * Not persisted. A custom tile URL that 404s, or one the browser blocks, is
 * indistinguishable from "no data here" without these.
 *
 * @module tile-health-store
 * @license GPL-3.0-only
 */
import { create } from "zustand";

interface TileHealthState {
  /** Template being observed. Counters reset when it changes. */
  template: string;
  loaded: number;
  errors: number;
  lastErrorUrl: string | null;
  observe: (template: string) => void;
  recordLoad: () => void;
  recordError: (tileUrl: string | null) => void;
}

export const useTileHealthStore = create<TileHealthState>((set) => ({
  template: "",
  loaded: 0,
  errors: 0,
  lastErrorUrl: null,
  observe: (template) =>
    set((s) =>
      s.template === template ? s : { template, loaded: 0, errors: 0, lastErrorUrl: null },
    ),
  recordLoad: () => set((s) => ({ loaded: s.loaded + 1 })),
  recordError: (tileUrl) =>
    set((s) => ({ errors: s.errors + 1, lastErrorUrl: tileUrl ?? s.lastErrorUrl })),
}));
