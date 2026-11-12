/**
 * @module use-planner-validation
 * @description The open plan's validation result, shared by every planner
 * surface that shows it (the bar's issue chip, the map's terrain-clash legs).
 * Each caller builds its own options object, so the result is cached on the
 * waypoint list and a structural comparison of the options: callers that see
 * the same plan and the same store state share one validator run.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useValidationOptions } from "@/hooks/use-validation-options";
import { validateMission } from "@/lib/validation/mission-validator";
import type { ValidationOptions, ValidationResult } from "@/lib/validation/issue-types";
import type { Waypoint } from "@/lib/types";

/**
 * Equal by identity, or plain objects whose keys are equal down to `depth`
 * levels. Arrays and maps compare by identity: they come straight from the
 * stores, so the same store state hands every caller the same instance.
 */
function sameValue(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (depth === 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b) || a instanceof Map || b instanceof Map) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) =>
    sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1),
  );
}

let cache: { waypoints: readonly Waypoint[]; options: ValidationOptions; result: ValidationResult } | null = null;

/** `validateMission`, reusing the last result when the inputs are the same. */
export function sharedValidation(waypoints: Waypoint[], options: ValidationOptions): ValidationResult {
  if (cache && cache.waypoints === waypoints && sameValue(cache.options, options, 3)) return cache.result;
  const result = validateMission(waypoints, options);
  cache = { waypoints, options, result };
  return result;
}

/** The validation result of `waypoints` under the planner's options; `null` for an empty plan. */
export function usePlannerValidation(waypoints: Waypoint[]): ValidationResult | null {
  const options = useValidationOptions();
  return useMemo(
    () => (waypoints.length > 0 ? sharedValidation(waypoints, options) : null),
    [waypoints, options],
  );
}
