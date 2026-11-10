/**
 * @module cockpit/layers/layer-spec
 * @description The cockpit spec's data layers (`spec/layers.json`) and views
 * (`spec/views.json`) as typed values, and the rule that turns the operator's
 * level, per-layer flips and the open view into the set of layers drawn.
 *
 * - Instruments and Full: every layer whose default is on, except a layer
 *   `levels.only_at_levels` keeps to other levels (the flight instruments
 *   draw only at Instruments). Route: the spec's route list. Off: the
 *   spec's off list (the centre marks).
 * - A layer listed in `only_at_levels` never draws at another level, flip
 *   or not; its flip can still turn it off where it does draw.
 * - `depth` and `surfaces` (leased layers) ignore the level: only their own
 *   flip, or a view that forces them, turns them on.
 * - A flip overrides the level for that layer; a view's forced layers are on
 *   while it is open.
 *
 * @license GPL-3.0-only
 */

import layersSpec from "@/lib/cockpit-spec/layers.json";
import viewsSpec from "@/lib/cockpit-spec/views.json";

import type { LayerLevel } from "@/stores/cockpit-layers-store";

/** The four cockpit views, as the spec cycles them. */
export type LayerStackView = "pilot" | "map" | "split" | "vision";

export interface LayerDef {
  id: string;
  label: string;
  default: boolean;
  lease: boolean;
  z: number;
}

export const LAYER_DEFS: readonly LayerDef[] = [...layersSpec.layers]
  .map((l) => ({ id: l.id, label: l.label, default: l.default, lease: l.lease, z: l.z }))
  .sort((a, b) => a.z - b.z);

const ROUTE_LAYERS: ReadonlySet<string> = new Set(layersSpec.levels.route.layers);
const OFF_LAYERS: ReadonlySet<string> = new Set(layersSpec.levels.off.layers);
const ONLY_AT: Readonly<Record<string, readonly string[]>> = layersSpec.levels.only_at_levels;

const FORCED: Record<string, ReadonlySet<string>> = Object.fromEntries(
  viewsSpec.views.map((v) => [v.id, new Set<string>(v.forced_layers)]),
);

export const LAYER_DIM_MS = layersSpec.staleness.dim_after_ms;
export const LAYER_HIDE_MS = layersSpec.staleness.hide_after_ms;

/** Whether `id` may draw at `level` at all (`levels.only_at_levels`). */
export function allowedAtLevel(id: string, level: LayerLevel): boolean {
  const only = ONLY_AT[id];
  return only === undefined || only.includes(level);
}

/** Is `id` on at `level` before any flip? */
function onAtLevel(def: LayerDef, level: LayerLevel): boolean {
  if (def.lease) return def.default;
  if (level === "full" || level === "instruments") return def.default;
  if (level === "route") return ROUTE_LAYERS.has(def.id);
  return OFF_LAYERS.has(def.id);
}

/** The layer ids drawn for this level, flip set and view. */
export function effectiveLayers(
  level: LayerLevel,
  flips: Readonly<Record<string, boolean>>,
  view: LayerStackView,
): Set<string> {
  const out = new Set<string>();
  const forced = FORCED[view];
  for (const def of LAYER_DEFS) {
    if (!allowedAtLevel(def.id, level)) continue;
    const on = forced?.has(def.id) || (flips[def.id] ?? onAtLevel(def, level));
    if (on) out.add(def.id);
  }
  return out;
}
