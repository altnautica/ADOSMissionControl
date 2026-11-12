/**
 * @module validation/regulatory-ceiling
 * @description The operator jurisdiction's altitude ceiling, in metres above
 * home, for the planner's advisory altitude check. It applies whether or not
 * a fence is enabled; with no jurisdiction chosen the common 120 m limit is
 * used.
 * @license GPL-3.0-only
 */

import { JURISDICTIONS, type Jurisdiction } from "@/lib/jurisdiction";

/** Ceiling used when no jurisdiction is set, metres above home. */
export const DEFAULT_ALTITUDE_CEILING_M = 120;

const FEET_TO_M = 0.3048;

/**
 * Ceiling in metres for `jurisdiction`, read from its `maxAltitude` label
 * ("120m", "400ft"); the default when none is set or the label is unreadable.
 */
export function regulatoryCeilingMetres(jurisdiction: Jurisdiction | null): number {
  const label = jurisdiction ? JURISDICTIONS[jurisdiction]?.maxAltitude : undefined;
  const match = label ? /^\s*(\d+(?:\.\d+)?)\s*(m|ft)\s*$/i.exec(label) : null;
  if (!match) return DEFAULT_ALTITUDE_CEILING_M;
  const value = Number(match[1]);
  return match[2].toLowerCase() === "ft" ? Math.round(value * FEET_TO_M) : value;
}
