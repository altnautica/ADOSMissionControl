/**
 * @module fc/calibration/compass-save-entries
 * @description The COMPASS_OFS / DIA / ODI writes for a compass force-save.
 * Only a compass whose fit the flight controller reported as successful
 * (MAG_CAL_SUCCESS, status 4) is written; a rejected fit (bad radius, bad
 * orientation, failed) never lands in the vehicle's offsets.
 * @license GPL-3.0-only
 */

import type { ParamBatchEntry } from "@/lib/protocol/param-write";
import type { CompassResult } from "./calibration-types";

/** MAG_CAL_STATUS value for a fit the flight controller accepted. */
export const MAG_CAL_SUCCESS = 4;

export interface CompassSavePlan {
  entries: ParamBatchEntry[];
  /** Compass ids written. */
  saved: number[];
  /** Compass ids skipped because their fit did not succeed. */
  skipped: number[];
}

export function compassSaveEntries(
  results: ReadonlyMap<number, CompassResult>,
  current: ReadonlyMap<string, number> | null,
): CompassSavePlan {
  const entries: ParamBatchEntry[] = [];
  const saved: number[] = [];
  const skipped: number[] = [];
  for (const [compassId, r] of results) {
    if (r.calStatus !== MAG_CAL_SUCCESS) { skipped.push(compassId); continue; }
    saved.push(compassId);
    const suffix = compassId === 0 ? "" : `${compassId + 1}`;
    const push = (group: string, x: number, y: number, z: number) => {
      for (const [axis, value] of [["X", x], ["Y", y], ["Z", z]] as const) {
        const name = `COMPASS_${group}${suffix}_${axis}`;
        entries.push({ name, value, oldValue: current?.get(name) ?? 0 });
      }
    };
    push("OFS", r.ofsX, r.ofsY, r.ofsZ);
    if (r.diagX !== 1 || r.diagY !== 1 || r.diagZ !== 1) push("DIA", r.diagX, r.diagY, r.diagZ);
    if (r.offdiagX !== 0 || r.offdiagY !== 0 || r.offdiagZ !== 0) push("ODI", r.offdiagX, r.offdiagY, r.offdiagZ);
  }
  return { entries, saved, skipped };
}
