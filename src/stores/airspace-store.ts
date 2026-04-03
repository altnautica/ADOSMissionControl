/**
 * @module airspace-store
 * @description Zustand store for airspace data: zones, NOTAMs, TFRs,
 * flyability assessment, and layer visibility for the Air Traffic tab.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { JURISDICTIONS, type Jurisdiction } from "@/lib/jurisdiction";
import type { Airport } from "@/lib/airspace/airport-database";
import type {
  AirspaceZone,
  Notam,
  TemporaryRestriction,
  Flyability,
  AirTrafficLayers,
} from "@/lib/airspace/types";
import { DEFAULT_LAYERS } from "@/lib/airspace/types";

export interface ViewportState {
  cameraAlt: number;
  visibleAirports: Airport[];
  aircraftInView: number;
}

export interface AltitudeFilter {
  min: number;
  max: number;
}

interface AirspaceStoreState {
  jurisdiction: Jurisdiction | null;
  zones: AirspaceZone[];
  notams: Notam[];
  tfrs: TemporaryRestriction[];
  selectedPoint: { lat: number; lon: number } | null;
  flyability: Flyability | null;
  layerVisibility: AirTrafficLayers;
  activeJurisdictions: Set<Jurisdiction>;
  viewportState: ViewportState;
  operationalAltitude: number;
  timelineTime: Date;
  showIcaoZones: boolean;
  altitudeFilter: AltitudeFilter;
  loading: boolean;
  error: string | null;

  setShowIcaoZones: (show: boolean) => void;
  setJurisdiction: (j: Jurisdiction | null) => void;
  setZones: (zones: AirspaceZone[]) => void;
  mergeZones: (incoming: AirspaceZone[]) => void;
  setNotams: (notams: Notam[]) => void;
  setTfrs: (tfrs: TemporaryRestriction[]) => void;
  setSelectedPoint: (point: { lat: number; lon: number } | null) => void;
  setFlyability: (f: Flyability | null) => void;
  setLayerVisibility: (layer: keyof AirTrafficLayers, visible: boolean) => void;
  setActiveJurisdictions: (jurisdictions: Set<Jurisdiction>) => void;
  toggleJurisdiction: (j: Jurisdiction) => void;
  setViewportState: (vs: ViewportState) => void;
  setOperationalAltitude: (alt: number) => void;
  setTimelineTime: (time: Date) => void;
  setAltitudeFilter: (filter: AltitudeFilter) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

const INITIAL_STATE = {
  jurisdiction: null as Jurisdiction | null,
  zones: [] as AirspaceZone[],
  notams: [] as Notam[],
  tfrs: [] as TemporaryRestriction[],
  selectedPoint: null as { lat: number; lon: number } | null,
  flyability: null as Flyability | null,
  layerVisibility: { ...DEFAULT_LAYERS },
  activeJurisdictions: new Set<Jurisdiction>(Object.keys(JURISDICTIONS) as Jurisdiction[]),
  viewportState: { cameraAlt: 0, visibleAirports: [], aircraftInView: 0 } as ViewportState,
  operationalAltitude: 120,
  showIcaoZones: true,
  altitudeFilter: { min: 0, max: 15000 } as AltitudeFilter,
  timelineTime: new Date(),
  loading: false,
  error: null as string | null,
};

export const useAirspaceStore = create<AirspaceStoreState>()((set) => ({
  ...INITIAL_STATE,

  setShowIcaoZones: (showIcaoZones) => set({ showIcaoZones }),
  setJurisdiction: (jurisdiction) => set({ jurisdiction }),
  setZones: (zones) => set({ zones }),
  mergeZones: (incoming) =>
    set((s) => {
      const idMap = new Map(s.zones.map((z) => [z.id, z]));
      for (const z of incoming) idMap.set(z.id, z);
      return { zones: Array.from(idMap.values()) };
    }),
  setNotams: (notams) => set({ notams }),
  setTfrs: (tfrs) => set({ tfrs }),
  setSelectedPoint: (selectedPoint) => set({ selectedPoint }),
  setFlyability: (flyability) => set({ flyability }),
  setLayerVisibility: (layer, visible) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [layer]: visible },
    })),
  setActiveJurisdictions: (activeJurisdictions) => set({ activeJurisdictions }),
  toggleJurisdiction: (j) =>
    set((s) => {
      const next = new Set(s.activeJurisdictions);
      if (next.has(j)) next.delete(j);
      else next.add(j);
      return { activeJurisdictions: next };
    }),
  setViewportState: (viewportState) => set({ viewportState }),
  setOperationalAltitude: (operationalAltitude) => set({ operationalAltitude }),
  setTimelineTime: (timelineTime) => set({ timelineTime }),
  setAltitudeFilter: (altitudeFilter) => set({ altitudeFilter }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clear: () => set({ ...INITIAL_STATE, timelineTime: new Date() }),
}));
