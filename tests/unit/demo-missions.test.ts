import { describe, it, expect } from 'vitest';
import { DEMO_PLANS, DEMO_PLAN_IDS } from '@/mock/demo-missions';
import { validateMission } from '@/lib/validation/mission-validator';
import type { ValidationOptions } from '@/lib/validation/issue-types';
import type { GeofenceSnapshot } from '@/stores/geofence-store';
import type { RallyPoint } from '@/stores/rally-store';

/** Build validation options from a plan's saved fence/rally, matching the app. */
function optionsFor(geofence?: GeofenceSnapshot, rally?: RallyPoint[]): ValidationOptions | undefined {
  const geo: NonNullable<ValidationOptions['geofence']> = {};
  if (geofence?.enabled) {
    if (geofence.maxAltitude > 0) geo.maxAltitude = geofence.maxAltitude;
    if (geofence.minAltitude > 0) geo.minAltitude = geofence.minAltitude;
    if (geofence.fenceType === 'polygon' && geofence.polygonPoints.length >= 3) geo.polygonPoints = geofence.polygonPoints;
    if (geofence.fenceType === 'circle' && geofence.circleCenter) {
      geo.circleCenter = geofence.circleCenter;
      geo.circleRadius = geofence.circleRadius;
    }
  }
  if (geofence && geofence.zones.length > 0) geo.zones = geofence.zones;
  const hasFence = Object.keys(geo).length > 0;
  const r = rally && rally.length > 0 ? rally : undefined;
  if (!hasFence && !r) return undefined;
  return { geofence: hasFence ? geo : undefined, rally: r };
}

describe('demo missions', () => {
  it('ships exactly 5 missions with stable demo- ids', () => {
    expect(DEMO_PLANS).toHaveLength(5);
    expect(DEMO_PLAN_IDS.every((id) => id.startsWith('demo-'))).toBe(true);
  });

  for (const plan of DEMO_PLANS) {
    it(`"${plan.name}" validates with zero errors`, () => {
      const result = validateMission(plan.waypoints, optionsFor(plan.geofence, plan.rally));
      // Surface the offending codes if this ever regresses.
      expect(result.errors.map((e) => e.code)).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it(`"${plan.name}" starts with a takeoff and ends with a land/RTL`, () => {
      const first = plan.waypoints[0].command;
      const last = plan.waypoints[plan.waypoints.length - 1].command;
      expect(first === 'TAKEOFF' || first === 'VTOL_TAKEOFF').toBe(true);
      expect(last === 'LAND' || last === 'VTOL_LAND' || last === 'RTL').toBe(true);
    });
  }
});
