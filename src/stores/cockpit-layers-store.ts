/**
 * The cockpit's data-layer level (Full / Route / Off) and per-layer switches,
 * persisted per vehicle. Which layers a level turns on comes from the cockpit
 * spec (`lib/cockpit/layers/layer-spec`); this store keeps only the operator's
 * choices: the level and the layers flipped away from it.
 *
 * Changing the level drops the per-layer flips, so a level always means the
 * same thing on screen.
 *
 * @module cockpit-layers-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type LayerLevel = "full" | "route" | "off";

export const LAYER_LEVELS: readonly LayerLevel[] = ["full", "route", "off"];
export const DEFAULT_LAYER_LEVEL: LayerLevel = "full";

export type DepthStyle = "solid" | "outline";
/** Depth range: Off, 2 m, 5 m (cockpit spec `options.depth.range_m`). */
export type DepthRange = "off" | "2" | "5";

export interface VehicleLayers {
  level: LayerLevel;
  /** Layer id → on/off where the operator overrode the level. */
  flips: Record<string, boolean>;
  depthStyle: DepthStyle;
  depthRange: DepthRange;
}

const DEFAULT_VEHICLE: VehicleLayers = { level: DEFAULT_LAYER_LEVEL, flips: {}, depthStyle: "solid", depthRange: "5" };

interface CockpitLayersState {
  byVehicle: Record<string, VehicleLayers>;
  setLevel: (droneId: string, level: LayerLevel) => void;
  /** Full → Route → Off → Full. */
  cycleLevel: (droneId: string) => void;
  /** Turn one layer on or off, overriding the level. */
  setLayer: (droneId: string, layerId: string, on: boolean) => void;
  setDepth: (droneId: string, style: DepthStyle, range: DepthRange) => void;
}

export function vehicleLayers(
  byVehicle: Record<string, VehicleLayers>,
  droneId: string | null | undefined,
): VehicleLayers {
  return (droneId && byVehicle[droneId]) || DEFAULT_VEHICLE;
}

export const useCockpitLayersStore = create<CockpitLayersState>()(
  persist(
    (set) => ({
      byVehicle: {},
      setLevel: (droneId, level) =>
        set((s) => ({ byVehicle: { ...s.byVehicle, [droneId]: { ...vehicleLayers(s.byVehicle, droneId), level, flips: {} } } })),
      cycleLevel: (droneId) =>
        set((s) => {
          const cur = vehicleLayers(s.byVehicle, droneId).level;
          const level = LAYER_LEVELS[(LAYER_LEVELS.indexOf(cur) + 1) % LAYER_LEVELS.length];
          return { byVehicle: { ...s.byVehicle, [droneId]: { ...vehicleLayers(s.byVehicle, droneId), level, flips: {} } } };
        }),
      setLayer: (droneId, layerId, on) =>
        set((s) => {
          const cur = vehicleLayers(s.byVehicle, droneId);
          return {
            byVehicle: { ...s.byVehicle, [droneId]: { ...cur, flips: { ...cur.flips, [layerId]: on } } },
          };
        }),
      setDepth: (droneId, depthStyle, depthRange) =>
        set((s) => ({ byVehicle: { ...s.byVehicle, [droneId]: { ...vehicleLayers(s.byVehicle, droneId), depthStyle, depthRange } } })),
    }),
    {
      name: "altcmd:cockpit-layers",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      partialize: (s) => ({ byVehicle: s.byVehicle }),
      version: 1,
      // Identity at v1; malformed entries are dropped. Bump `version` and add
      // a branch here when the persisted shape changes.
      migrate: (persisted) => {
        const raw = (persisted as { byVehicle?: unknown } | null)?.byVehicle;
        const byVehicle: Record<string, VehicleLayers> = {};
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
            const e = v as { level?: unknown; flips?: unknown; depthStyle?: unknown; depthRange?: unknown } | null;
            if (!e || !(LAYER_LEVELS as readonly unknown[]).includes(e.level)) continue;
            const flips: Record<string, boolean> = {};
            if (e.flips && typeof e.flips === "object") {
              for (const [k, f] of Object.entries(e.flips as Record<string, unknown>)) {
                if (typeof f === "boolean") flips[k] = f;
              }
            }
            byVehicle[id] = {
              level: e.level as LayerLevel,
              flips,
              depthStyle: e.depthStyle === "outline" ? "outline" : "solid",
              depthRange: e.depthRange === "off" || e.depthRange === "2" ? e.depthRange : "5",
            };
          }
        }
        return { byVehicle } as CockpitLayersState;
      },
    },
  ),
);

/** The level for one vehicle. */
export function useLayerLevel(droneId: string | null | undefined): LayerLevel {
  return useCockpitLayersStore((s) => vehicleLayers(s.byVehicle, droneId).level);
}
