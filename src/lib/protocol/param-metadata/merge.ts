/**
 * Field-wise metadata merge.
 *
 * The provider layers a bundled floor (always present) under increasingly
 * exact overlays (hosted version-matched snapshot, then live FC-served
 * metadata). Merging is "more-exact-wins, but never lose a field the base
 * has" — an overlay refines ranges/defaults and adds version-new params, yet
 * a label the overlay lacks is preserved from the floor.
 *
 * @module protocol/param-metadata/merge
 * @license GPL-3.0-only
 */

import type { ParamMetadata } from "./types";

/** Merge a single overlay entry over a base entry (overlay wins where defined). */
export function mergeMeta(base: ParamMetadata, overlay: ParamMetadata): ParamMetadata {
  const out: ParamMetadata = { ...base };
  for (const key of Object.keys(overlay) as (keyof ParamMetadata)[]) {
    const v = overlay[key];
    if (v === undefined || v === null) continue;
    // A Map overlay replaces the base Map only when it is non-empty.
    if (v instanceof Map) {
      if (v.size > 0) Object.assign(out, { [key]: v });
      continue;
    }
    Object.assign(out, { [key]: v });
  }
  return out;
}

/**
 * Merge an overlay map over a base map. Params present only in the overlay are
 * added; params present in both are field-merged; base-only params are kept.
 * Returns a new Map (inputs are not mutated).
 */
export function mergeMetaMaps(
  base: Map<string, ParamMetadata>,
  overlay: Map<string, ParamMetadata>,
): Map<string, ParamMetadata> {
  if (overlay.size === 0) return base;
  if (base.size === 0) return overlay;
  const out = new Map(base);
  for (const [name, ov] of overlay) {
    const b = out.get(name);
    out.set(name, b ? mergeMeta(b, ov) : ov);
  }
  return out;
}
