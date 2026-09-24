import { create } from "zustand";
import { droneSelection } from "./drone-selection";

interface PanelCacheEntry {
  params: Map<string, number>;
  originalValues: Map<string, number>;
  timestamp: number;
}

interface PanelCacheState {
  cache: Map<string, PanelCacheEntry>;
  cachePanel: (panelId: string, params: Map<string, number>, originalValues: Map<string, number>) => void;
  getCachedPanel: (panelId: string) => PanelCacheEntry | null;
  invalidateParam: (paramName: string) => void;
  invalidatePanel: (panelId: string) => void;
  /** Drop every cached panel belonging to a specific drone. */
  clearForDrone: (droneId: string) => void;
  clear: () => void;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Cache entries are stored under a composite key so two drones that expose the
 * same panel never read each other's parameter values. The panel components
 * pass only their stable panelId; the owning drone is resolved here from the
 * current selection at call time. A drone with no identity (direct serial)
 * falls back to a single sentinel so the cache still works.
 */
const NO_DRONE = "__none__";
const KEY_SEP = "::";

function currentDroneId(): string {
  return droneSelection().selectedDroneId ?? NO_DRONE;
}

function composeKey(droneId: string, panelId: string): string {
  return `${droneId}${KEY_SEP}${panelId}`;
}

export const usePanelCacheStore = create<PanelCacheState>((set, get) => ({
  cache: new Map(),

  cachePanel: (panelId, params, originalValues) => {
    const cache = new Map(get().cache);
    cache.set(composeKey(currentDroneId(), panelId), {
      params: new Map(params),
      originalValues: new Map(originalValues),
      timestamp: Date.now(),
    });
    set({ cache });
  },

  getCachedPanel: (panelId) => {
    const key = composeKey(currentDroneId(), panelId);
    const entry = get().cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      // Expired — remove and return null
      const cache = new Map(get().cache);
      cache.delete(key);
      set({ cache });
      return null;
    }
    return entry;
  },

  invalidateParam: (paramName) => {
    const cache = new Map(get().cache);
    for (const [key, entry] of cache) {
      if (entry.params.has(paramName)) {
        cache.delete(key);
      }
    }
    set({ cache });
  },

  invalidatePanel: (panelId) => {
    const cache = new Map(get().cache);
    cache.delete(composeKey(currentDroneId(), panelId));
    set({ cache });
  },

  clearForDrone: (droneId) => {
    const prefix = `${droneId}${KEY_SEP}`;
    const cache = new Map(get().cache);
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
      }
    }
    set({ cache });
  },

  clear: () => set({ cache: new Map() }),
}));
