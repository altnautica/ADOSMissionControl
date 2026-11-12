/**
 * @module library/import-content
 * @description Whether an imported plan file carries anything to plan with.
 * A file with only a fence, rally points or points of interest is a real plan
 * (an exported fence-only plan must round-trip); only a file with none of
 * those and no waypoints is refused.
 * @license GPL-3.0-only
 */

import type { ImportedMission } from "@/lib/mission-io";

export function importedPlanHasContent(result: ImportedMission): boolean {
  const g = result.geofence;
  const fence =
    (result.fenceZones?.length ?? 0) > 0 ||
    (g !== undefined && (g.polygonPoints.length >= 3 || g.circleCenter !== null || g.zones.length > 0));
  return (
    result.waypoints.length > 0 ||
    fence ||
    (result.rally?.length ?? 0) > 0 ||
    (result.pois?.length ?? 0) > 0
  );
}
