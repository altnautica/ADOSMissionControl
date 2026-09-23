/**
 * @module CoverageOverlay
 * @description Draws the ground footprint of each camera capture of the survey
 * being configured, so the operator can see where images overlap and where gaps
 * open up. Display-only. The captures come from the generated pattern route (the
 * one the toggle sits beside): every trigger-distance step along each armed leg,
 * at that point's own altitude. Renders nothing unless the coverage toggle is
 * on, a camera is selected and a pattern has been generated. At most
 * `MAX_FOOTPRINTS` are drawn; `useCoverageCaptures` reports the full
 * count so the survey panel can say when the overlay is truncated.
 * Must render inside a react-leaflet MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { memo, useMemo } from "react";
import { Polygon } from "react-leaflet";
import { usePatternStore } from "@/stores/pattern-store";
import { CAMERA_PROFILES } from "@/lib/patterns/gsd-calculator";
import { MAP_COLORS } from "@/lib/map-constants";
import { buildFootprintPolygons } from "@/lib/patterns/coverage-footprints";
import { useCoverageCaptures } from "@/hooks/use-coverage-captures";

const FOOTPRINT_STYLE = {
  color: MAP_COLORS.coverage,
  weight: 0.5,
  opacity: 0.6,
  fillColor: MAP_COLORS.coverage,
  fillOpacity: 0.12,
  interactive: false,
};

export const CoverageOverlay = memo(function CoverageOverlay() {
  const showCoverageOverlay = usePatternStore((s) => s.showCoverageOverlay);
  const cameraName = usePatternStore((s) => (s.surveyConfig as { _cameraName?: string })._cameraName);
  const { points } = useCoverageCaptures();

  const footprints = useMemo(() => {
    if (!showCoverageOverlay) return [];
    const camera = CAMERA_PROFILES.find((c) => c.name === cameraName);
    return camera ? buildFootprintPolygons(points, camera) : [];
  }, [showCoverageOverlay, cameraName, points]);

  if (footprints.length === 0) return null;

  return (
    <>
      {footprints.map((positions, i) => (
        <Polygon key={i} positions={positions} pathOptions={FOOTPRINT_STYLE} />
      ))}
    </>
  );
});
