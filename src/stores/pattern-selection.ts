/**
 * @module pattern-selection
 * @description Choosing the active flight pattern touches two stores: the
 * pattern store takes the new type, and a datum armed on the planner is
 * re-pointed at it so the next map click never sets the previously-active
 * pattern's origin. The action lives here so the pattern store never imports
 * the planner store (the planner already reads the pattern store).
 * @license GPL-3.0-only
 */

import type { DatumPattern } from "@/lib/planner-mode";
import { usePatternStore, type PatternType } from "./pattern-store";
import { usePlannerStore } from "./planner-store";

/** Activate a flight pattern, keeping an armed datum aimed at it. Landing
 * patterns have no datum, so they disarm the pattern origin. */
export function selectPatternType(type: PatternType): void {
  usePatternStore.getState().setPatternType(type);
  const planner = usePlannerStore.getState();
  if (planner.mode.kind === "datum") {
    const pattern: DatumPattern = type === "fixedWingLanding" || type === "vtolLanding" ? null : type;
    planner.armDatum(pattern);
  }
}
