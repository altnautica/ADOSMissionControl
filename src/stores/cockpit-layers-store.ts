/**
 * The cockpit's data-layer level (Instruments / Full / Route / Off) and
 * per-layer switches, persisted per vehicle. Which layers a level turns on
 * comes from the cockpit spec (`lib/cockpit/layers/layer-spec`); this store
 * keeps only the operator's choices: the level and the layers flipped away
 * from it.
 *
 * A vehicle with no stored level shows the default of the cockpit's current
 * layout class (`layout.json` `classes.*.default_layer_level`: Route on
 * compact and portrait, Full otherwise), which the cockpit publishes with
 * {@link CockpitLayersState.setClassDefault}.
 *
 * Flipping one layer or the depth style on such a vehicle stores the flip
 * but not the level: the level keeps following the class default.
 *
 * Changing the level drops the per-layer flips, so a level always means the
 * same thing on screen.
 *
 * @module cockpit-layers-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import layersSpec from "@/lib/cockpit/spec/layers.json";
import type { LayerLevel } from "@/lib/hud/ar-layout";

export type { LayerLevel };

/** Most to least drawn, as every level control cycles them. */
export const LAYER_LEVELS: readonly LayerLevel[] = layersSpec.levels.order as LayerLevel[];
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
  /** The level was not chosen by the operator (only a layer switch or the
   * depth style was): it follows the layout class's default. */
  levelFromClass?: boolean;
}

/** One stable default entry per level, so a selector returning it is stable. */
const DEFAULT_BY_LEVEL: Record<LayerLevel, VehicleLayers> = {
  instruments: { level: "instruments", flips: {}, depthStyle: "solid", depthRange: "5" },
  full: { level: "full", flips: {}, depthStyle: "solid", depthRange: "5" },
  route: { level: "route", flips: {}, depthStyle: "solid", depthRange: "5" },
  off: { level: "off", flips: {}, depthStyle: "solid", depthRange: "5" },
};

interface CockpitLayersState {
  byVehicle: Record<string, VehicleLayers>;
  /** The level a vehicle without a stored one shows (the layout class's). */
  classDefault: LayerLevel;
  setClassDefault: (level: LayerLevel) => void;
  setLevel: (droneId: string, level: LayerLevel) => void;
  /** One step down `levels.order`, wrapping: Instruments → Full → Route → Off → Instruments. */
  cycleLevel: (droneId: string) => void;
  /** Step `by` places along `levels.order` (negative = towards Instruments), wrapping. */
  stepLevel: (droneId: string, by: number) => void;
  /** Turn one layer on or off, overriding the level. */
  setLayer: (droneId: string, layerId: string, on: boolean) => void;
  setDepth: (droneId: string, style: DepthStyle, range: DepthRange) => void;
}

export function vehicleLayers(
  byVehicle: Record<string, VehicleLayers>,
  droneId: string | null | undefined,
  classDefault: LayerLevel = DEFAULT_LAYER_LEVEL,
): VehicleLayers {
  return (droneId && byVehicle[droneId]) || DEFAULT_BY_LEVEL[classDefault];
}

function stepped(cur: LayerLevel, by: number): LayerLevel {
  const n = LAYER_LEVELS.length;
  return LAYER_LEVELS[(((LAYER_LEVELS.indexOf(cur) + by) % n) + n) % n];
}

/** The vehicle's entry with an operator-chosen level (the flips dropped). */
function chosenLevel(
  s: CockpitLayersState,
  droneId: string,
  level: (cur: LayerLevel) => LayerLevel,
): Pick<CockpitLayersState, "byVehicle"> {
  const { levelFromClass: _class, ...cur } = vehicleLayers(s.byVehicle, droneId, s.classDefault);
  return { byVehicle: { ...s.byVehicle, [droneId]: { ...cur, level: level(cur.level), flips: {} } } };
}

/** The vehicle's entry for a switch or depth change: a vehicle with no
 * stored entry keeps following the class default. */
function unchosenLevel(s: CockpitLayersState, droneId: string): VehicleLayers {
  const stored = s.byVehicle[droneId];
  return stored ?? { ...DEFAULT_BY_LEVEL[s.classDefault], levelFromClass: true };
}

export const useCockpitLayersStore = create<CockpitLayersState>()(
  persist(
    (set) => ({
      byVehicle: {},
      classDefault: DEFAULT_LAYER_LEVEL,
      setClassDefault: (classDefault) =>
        set((s) => {
          // Vehicles whose level follows the class move with it.
          let byVehicle = s.byVehicle;
          for (const [id, v] of Object.entries(s.byVehicle)) {
            if (!v.levelFromClass || v.level === classDefault) continue;
            if (byVehicle === s.byVehicle) byVehicle = { ...s.byVehicle };
            byVehicle[id] = { ...v, level: classDefault };
          }
          return s.classDefault === classDefault && byVehicle === s.byVehicle ? s : { classDefault, byVehicle };
        }),
      setLevel: (droneId, level) => set((s) => chosenLevel(s, droneId, () => level)),
      cycleLevel: (droneId) => set((s) => chosenLevel(s, droneId, (cur) => stepped(cur, 1))),
      stepLevel: (droneId, by) => set((s) => chosenLevel(s, droneId, (cur) => stepped(cur, by))),
      setLayer: (droneId, layerId, on) =>
        set((s) => {
          const cur = unchosenLevel(s, droneId);
          return { byVehicle: { ...s.byVehicle, [droneId]: { ...cur, flips: { ...cur.flips, [layerId]: on } } } };
        }),
      setDepth: (droneId, depthStyle, depthRange) =>
        set((s) => ({ byVehicle: { ...s.byVehicle, [droneId]: { ...unchosenLevel(s, droneId), depthStyle, depthRange } } })),
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
            const e = v as {
              level?: unknown;
              flips?: unknown;
              depthStyle?: unknown;
              depthRange?: unknown;
              levelFromClass?: unknown;
            } | null;
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
              ...(e.levelFromClass === true ? { levelFromClass: true } : {}),
            };
          }
        }
        return { byVehicle } as CockpitLayersState;
      },
    },
  ),
);

/** The layers state of one vehicle, the class default when none is stored. */
export function useVehicleLayers(droneId: string | null | undefined): VehicleLayers {
  return useCockpitLayersStore((s) => vehicleLayers(s.byVehicle, droneId, s.classDefault));
}

/** The level for one vehicle. */
export function useLayerLevel(droneId: string | null | undefined): LayerLevel {
  return useCockpitLayersStore((s) => vehicleLayers(s.byVehicle, droneId, s.classDefault).level);
}
