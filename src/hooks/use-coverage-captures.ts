/**
 * @module use-coverage-captures
 * @description Camera capture points of the generated pattern route, capped at
 * {@link MAX_FOOTPRINTS}, with the full count so a truncated coverage overlay
 * can be surfaced. Leaflet-free, so a settings panel can read the count.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { usePatternStore } from "@/stores/pattern-store";
import { sampleCapturePoints, MAX_FOOTPRINTS, type CapturePoint } from "@/lib/patterns/coverage-footprints";

const NO_CAPTURES = { points: [] as CapturePoint[], total: 0 };

export function useCoverageCaptures(): { points: CapturePoint[]; total: number } {
  const patternResult = usePatternStore((s) => s.patternResult);
  return useMemo(
    () => (patternResult ? sampleCapturePoints(patternResult.waypoints, MAX_FOOTPRINTS) : NO_CAPTURES),
    [patternResult],
  );
}
