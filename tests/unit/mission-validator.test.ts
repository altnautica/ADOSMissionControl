import { describe, it, expect } from 'vitest';
import { validateMission } from '@/lib/validation/mission-validator';
import type { Waypoint } from '@/lib/types/mission';

function wp(overrides: Partial<Waypoint> & { lat: number; lon: number }): Waypoint {
  return {
    id: Math.random().toString(36).slice(2, 10),
    alt: 50,
    command: 'WAYPOINT',
    ...overrides,
  };
}

describe('validateMission', () => {
  it('returns EMPTY_MISSION error for empty mission', () => {
    const result = validateMission([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('EMPTY_MISSION');
  });

  it('returns TOO_FEW_WAYPOINTS warning for single waypoint', () => {
    const result = validateMission([wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' })]);
    expect(result.warnings.some((w) => w.code === 'TOO_FEW_WAYPOINTS')).toBe(true);
  });

  it('returns NO_TAKEOFF warning when a ground-level mission does not start with TAKEOFF', () => {
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'WAYPOINT' }),
      wp({ lat: 12.98, lon: 77.60, command: 'LAND' }),
    ]);
    expect(result.warnings.some((w) => w.code === 'NO_TAKEOFF')).toBe(true);
    expect(result.errors.some((e) => e.code === 'MISSING_TAKEOFF')).toBe(false);
  });

  it('blocks MISSING_TAKEOFF when the mission starts airborne with no launch command', () => {
    // 50m in the relative frame means the vehicle is expected to already be
    // 50m above home at the first waypoint, with nothing to get it there.
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, alt: 50, command: 'WAYPOINT', frame: 'relative' }),
      wp({ lat: 12.98, lon: 77.60, command: 'LAND' }),
    ]);
    expect(result.valid).toBe(false);
    const issue = result.errors.find((e) => e.code === 'MISSING_TAKEOFF');
    expect(issue?.severity).toBe('blocking');
  });

  it('returns NO_LAND warning when last command is not LAND or RTL', () => {
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
      wp({ lat: 12.98, lon: 77.60, command: 'WAYPOINT' }),
    ]);
    expect(result.warnings.some((w) => w.code === 'NO_LAND')).toBe(true);
  });

  it('returns INVALID_COORDS error for lat > 90', () => {
    const result = validateMission([
      wp({ lat: 91, lon: 77.59, command: 'TAKEOFF' }),
      wp({ lat: 12.98, lon: 77.60, command: 'LAND' }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_COORDS')).toBe(true);
  });

  it('returns ALTITUDE_EXCEEDED error when altitude exceeds maxAltitude', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 200, command: 'TAKEOFF' }),
        wp({ lat: 12.98, lon: 77.60, alt: 50, command: 'LAND' }),
      ],
      { maxAltitude: 120 },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ALTITUDE_EXCEEDED')).toBe(true);
  });

  it('returns OUTSIDE_GEOFENCE error for point outside geofence polygon', () => {
    const polygon: [number, number][] = [
      [12.96, 77.58],
      [12.96, 77.60],
      [12.98, 77.60],
      [12.98, 77.58],
    ];
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
        wp({ lat: 13.10, lon: 77.59, command: 'LAND' }), // outside
      ],
      { geofence: { polygonPoints: polygon } },
    );
    expect(result.errors.some((e) => e.code === 'OUTSIDE_GEOFENCE')).toBe(true);
  });

  it('returns OUTSIDE_GEOFENCE error for point outside geofence circle', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
        wp({ lat: 13.10, lon: 77.59, command: 'LAND' }), // far outside
      ],
      { geofence: { circleCenter: [12.97, 77.59], circleRadius: 100 } },
    );
    expect(result.errors.some((e) => e.code === 'OUTSIDE_GEOFENCE')).toBe(true);
  });

  it('returns no OUTSIDE_GEOFENCE error for point inside geofence polygon', () => {
    const polygon: [number, number][] = [
      [12.96, 77.58],
      [12.96, 77.61],
      [12.99, 77.61],
      [12.99, 77.58],
    ];
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
        wp({ lat: 12.975, lon: 77.595, command: 'LAND' }),
      ],
      { geofence: { polygonPoints: polygon } },
    );
    expect(result.errors.filter((e) => e.code === 'OUTSIDE_GEOFENCE')).toHaveLength(0);
  });

  it('returns DUPLICATE_WAYPOINT warning for waypoints < 0.5m apart', () => {
    const result = validateMission([
      wp({ lat: 12.970000, lon: 77.590000, command: 'TAKEOFF' }),
      wp({ lat: 12.970000, lon: 77.590000, command: 'LAND' }), // same point
    ]);
    expect(result.warnings.some((w) => w.code === 'DUPLICATE_WAYPOINT')).toBe(true);
  });

  it('returns EXCESSIVE_DISTANCE warning for waypoints far apart', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
        wp({ lat: 20.00, lon: 77.59, command: 'LAND' }), // ~780 km
      ],
      { maxDistanceBetweenWps: 1000 }, // 1 km
    );
    expect(result.warnings.some((w) => w.code === 'EXCESSIVE_DISTANCE')).toBe(true);
  });

  it('returns ACTION_AS_NAV error when an action command is a top-level waypoint', () => {
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
      wp({ lat: 12.98, lon: 77.60, command: 'DO_JUMP', param1: 2 }), // action placed as its own row
      wp({ lat: 12.99, lon: 77.61, command: 'LAND' }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ACTION_AS_NAV')).toBe(true);
  });

  it('returns INVALID_JUMP_TARGET when a nested DO_JUMP action resolves to no waypoint', () => {
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
      wp({
        lat: 12.99,
        lon: 77.61,
        command: 'LAND',
        actions: [{ id: 'a1', command: 'DO_JUMP', jumpTargetId: 'does-not-exist' }],
      }),
    ]);
    expect(result.errors.some((e) => e.code === 'INVALID_JUMP_TARGET')).toBe(true);
  });

  it('accepts a nested DO_JUMP action that targets a real waypoint id', () => {
    const target = wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' });
    const result = validateMission([
      target,
      wp({
        lat: 12.99,
        lon: 77.61,
        command: 'LAND',
        actions: [{ id: 'a1', command: 'DO_JUMP', jumpTargetId: target.id, param2: 3 }],
      }),
    ]);
    expect(result.errors.some((e) => e.code === 'INVALID_JUMP_TARGET')).toBe(false);
  });

  it('warns JUMP_REPEAT_FOREVER for a FORWARD jump with a negative repeat count', () => {
    const target = wp({ lat: 12.99, lon: 77.61, command: 'LAND' });
    const result = validateMission([
      wp({
        lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF',
        actions: [{ id: 'a1', command: 'DO_JUMP', jumpTargetId: target.id, param2: -1 }],
      }),
      target,
    ]);
    expect(result.warnings.some((w) => w.code === 'JUMP_REPEAT_FOREVER')).toBe(true);
    expect(result.errors.some((e) => e.code === 'JUMP_LOOP_NO_EXIT')).toBe(false);
  });

  it('blocks JUMP_LOOP_NO_EXIT for a BACKWARD jump that repeats forever', () => {
    const target = wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF' });
    const result = validateMission([
      target,
      wp({
        lat: 12.99,
        lon: 77.61,
        command: 'LAND',
        actions: [{ id: 'a1', command: 'DO_JUMP', jumpTargetId: target.id, param2: -1 }],
      }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'JUMP_LOOP_NO_EXIT')).toBe(true);
  });

  it('returns INVALID_ACTION_COORDS for a nested ROI action with out-of-range coordinates', () => {
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
      wp({
        lat: 12.99,
        lon: 77.61,
        command: 'LAND',
        actions: [{ id: 'a1', command: 'ROI', lat: 200, lon: 77.6 }],
      }),
    ]);
    expect(result.errors.some((e) => e.code === 'INVALID_ACTION_COORDS')).toBe(true);
  });

  it('returns TERRAIN_CLEARANCE error for terrain clearance violation', () => {
    // Absolute-frame waypoint at 103m MSL over 100m-MSL ground = 3m clearance
    // < 5m. A mid-mission WAYPOINT, because TAKEOFF / LAND rows are
    // deliberately at the surface and exempt from the clearance rule.
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 100, command: 'TAKEOFF', frame: 'absolute', groundElevation: 100 }),
        wp({ lat: 12.98, lon: 77.60, alt: 103, command: 'WAYPOINT', frame: 'absolute', groundElevation: 100 }),
        wp({ lat: 12.99, lon: 77.61, alt: 100, command: 'LAND', frame: 'absolute', groundElevation: 100 }),
      ],
      { minTerrainClearance: 5 },
    );
    expect(result.errors.some((e) => e.code === 'TERRAIN_CLEARANCE')).toBe(true);
  });

  it('returns INSIDE_EXCLUSION_ZONE error for a waypoint inside an exclusion polygon', () => {
    const result = validateMission(
      [
        wp({ lat: 12.90, lon: 77.50, command: 'TAKEOFF' }),
        wp({ lat: 12.97, lon: 77.59, command: 'LAND' }), // inside the exclusion box
      ],
      {
        geofence: {
          zones: [{
            id: 'z1', role: 'exclusion', type: 'polygon',
            polygonPoints: [[12.96, 77.58], [12.96, 77.60], [12.98, 77.60], [12.98, 77.58]],
            circleCenter: null, circleRadius: 0,
          }],
        },
      },
    );
    expect(result.errors.some((e) => e.code === 'INSIDE_EXCLUSION_ZONE')).toBe(true);
  });

  it('returns OUTSIDE_GEOFENCE error for a waypoint outside an inclusion zone', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
        wp({ lat: 40.0, lon: 77.59, command: 'LAND' }), // far outside the inclusion box
      ],
      {
        geofence: {
          zones: [{
            id: 'z1', role: 'inclusion', type: 'polygon',
            polygonPoints: [[12.96, 77.58], [12.96, 77.61], [12.99, 77.61], [12.99, 77.58]],
            circleCenter: null, circleRadius: 0,
          }],
        },
      },
    );
    expect(result.errors.some((e) => e.code === 'OUTSIDE_GEOFENCE')).toBe(true);
  });

  it('returns BELOW_MIN_ALTITUDE error for a waypoint below the fence floor', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 10, command: 'TAKEOFF' }),
        wp({ lat: 12.98, lon: 77.60, alt: 30, command: 'LAND' }),
      ],
      { geofence: { minAltitude: 20 } },
    );
    expect(result.errors.some((e) => e.code === 'BELOW_MIN_ALTITUDE')).toBe(true);
  });

  it('flags a rally point that falls inside an exclusion zone', () => {
    const result = validateMission(
      [
        wp({ lat: 12.90, lon: 77.50, command: 'TAKEOFF' }),
        wp({ lat: 12.91, lon: 77.51, command: 'LAND' }),
      ],
      {
        geofence: {
          zones: [{
            id: 'z1', role: 'exclusion', type: 'circle',
            polygonPoints: [], circleCenter: [12.97, 77.59], circleRadius: 500,
          }],
        },
        rally: [{ id: 'r1', lat: 12.97, lon: 77.59, alt: 40 }], // dead center of the no-fly circle
      },
    );
    expect(result.errors.some((e) => e.code === 'RALLY_INSIDE_EXCLUSION_ZONE')).toBe(true);
  });

  it('returns SELF_INTERSECTING_FENCE warning for self-intersecting geofence', () => {
    // Bowtie polygon (self-intersecting)
    const polygon: [number, number][] = [
      [12.96, 77.58],
      [12.98, 77.60],
      [12.96, 77.60],
      [12.98, 77.58],
    ];
    const result = validateMission(
      [wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }), wp({ lat: 12.975, lon: 77.59, command: 'LAND' })],
      { geofence: { polygonPoints: polygon } },
    );
    expect(result.warnings.some((w) => w.code === 'SELF_INTERSECTING_FENCE')).toBe(true);
  });

  it('returns valid=true and no errors for a valid mission with TAKEOFF + waypoints + LAND', () => {
    const polygon: [number, number][] = [
      [12.96, 77.58],
      [12.96, 77.61],
      [12.99, 77.61],
      [12.99, 77.58],
    ];
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, command: 'TAKEOFF' }),
        wp({ lat: 12.975, lon: 77.595 }),
        wp({ lat: 12.98, lon: 77.60, command: 'LAND' }),
      ],
      { geofence: { polygonPoints: polygon }, maxAltitude: 120 },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

/**
 * The headline defect this suite exists to pin: `relative` frame means height
 * above HOME, not above ground. Conflating the two made a mission that flies
 * straight into rising terrain validate as clean.
 */
describe('validateMission — altitude frame correctness', () => {
  /**
   * Launch from 100m MSL ground, climb to 60m relative (= 160m MSL), fly to a
   * waypoint whose ground is 200m MSL. Real clearance there is 160 - 200 =
   * -40m: the vehicle is 40m UNDER the ridge. Reading `relative` alt as AGL
   * gives a comfortable 60m and reports the mission safe.
   */
  const risingTerrainMission = (): Waypoint[] => [
    wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF', frame: 'relative', groundElevation: 100 }),
    wp({ lat: 12.98, lon: 77.60, alt: 60, command: 'WAYPOINT', frame: 'relative', groundElevation: 200 }),
    wp({ lat: 12.99, lon: 77.61, alt: 0, command: 'LAND', frame: 'relative', groundElevation: 100 }),
  ];

  it('BLOCKS a relative-frame mission that crosses terrain rising above home', () => {
    const result = validateMission(risingTerrainMission(), { minTerrainClearance: 5 });
    const issue = result.errors.find((e) => e.code === 'TERRAIN_CLEARANCE');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('blocking');
    expect(issue?.waypointIndex).toBe(1);
    // The message reports the real clearance, not the raw altitude.
    expect(issue?.message).toContain('-40m above terrain');
    expect(result.valid).toBe(false);
  });

  it('passes the same geometry when the terrain does NOT rise above the flight height', () => {
    const flat = risingTerrainMission();
    flat[1] = { ...flat[1], groundElevation: 100 }; // clearance 60m
    const result = validateMission(flat, { minTerrainClearance: 5 });
    expect(result.errors.some((e) => e.code === 'TERRAIN_CLEARANCE')).toBe(false);
  });

  it('treats a terrain-frame altitude as AGL directly (no home datum needed)', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF', frame: 'terrain' }),
        wp({ lat: 12.98, lon: 77.60, alt: 30, command: 'LAND', frame: 'terrain' }),
      ],
      { minTerrainClearance: 5 },
    );
    expect(result.errors.some((e) => e.code === 'TERRAIN_CLEARANCE')).toBe(false);
    expect(result.warnings.some((w) => w.code === 'TERRAIN_UNCHECKED')).toBe(false);
  });

  it('WARNS LOUDLY rather than skipping when no elevation sample is available', () => {
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF' }),
      wp({ lat: 12.975, lon: 77.595, alt: 60, command: 'WAYPOINT' }),
      wp({ lat: 12.98, lon: 77.60, alt: 60, command: 'WAYPOINT' }),
      wp({ lat: 12.99, lon: 77.61, alt: 0, command: 'LAND' }),
    ]);
    // TAKEOFF and LAND are ground-contact rows and exempt; the two mid-mission
    // waypoints each report that the check could not be performed.
    const unchecked = result.warnings.filter((w) => w.code === 'TERRAIN_UNCHECKED');
    expect(unchecked).toHaveLength(2);
    expect(unchecked[0].severity).toBe('advisory');
    expect(result.warnings.some((w) => w.code === 'HOME_NOT_SET')).toBe(true);
  });

  it('normalises the fence ceiling to the above-home datum for an absolute-frame waypoint', () => {
    // 160m MSL over 100m-MSL home ground is 60m above home — inside a 120m
    // ceiling. Comparing the raw MSL value would reject a legal mission.
    const legal = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 100, command: 'TAKEOFF', frame: 'absolute', groundElevation: 100 }),
        wp({ lat: 12.98, lon: 77.60, alt: 160, command: 'LAND', frame: 'absolute', groundElevation: 100 }),
      ],
      { geofence: { maxAltitude: 120 }, minTerrainClearance: 5 },
    );
    expect(legal.errors.some((e) => e.code === 'ALTITUDE_EXCEEDED')).toBe(false);

    // 260m MSL is 160m above home — over the ceiling, and must be caught.
    const illegal = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 100, command: 'TAKEOFF', frame: 'absolute', groundElevation: 100 }),
        wp({ lat: 12.98, lon: 77.60, alt: 260, command: 'LAND', frame: 'absolute', groundElevation: 100 }),
      ],
      { geofence: { maxAltitude: 120 }, minTerrainClearance: 5 },
    );
    expect(illegal.errors.some((e) => e.code === 'ALTITUDE_EXCEEDED')).toBe(true);
  });

  it('reports the ceiling as UNCHECKED instead of guessing when home is unknown', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 100, command: 'TAKEOFF', frame: 'absolute' }),
        wp({ lat: 12.98, lon: 77.60, alt: 5000, command: 'LAND', frame: 'absolute' }),
      ],
      { geofence: { maxAltitude: 120 } },
    );
    expect(result.warnings.some((w) => w.code === 'ALTITUDE_UNCHECKED')).toBe(true);
  });
});

describe('validateMission — pattern-generated missions are terrain-checked', () => {
  /**
   * A survey pattern applied through `doPatternApply` samples terrain for every
   * generated waypoint. Once `groundElevation` is present the terrain rule runs
   * — previously nothing populated it, so the rule was skipped for every
   * pattern mission and the surface showed a green tick.
   */
  it('checks (not skips) terrain once the pattern lookup has populated elevations', () => {
    const generated: Waypoint[] = [
      wp({ lat: 12.970, lon: 77.590, alt: 0, command: 'TAKEOFF', frame: 'relative', groundElevation: 100 }),
      wp({ lat: 12.971, lon: 77.591, alt: 40, command: 'WAYPOINT', frame: 'relative', groundElevation: 100 }),
      wp({ lat: 12.972, lon: 77.592, alt: 40, command: 'WAYPOINT', frame: 'relative', groundElevation: 180 }),
      wp({ lat: 12.973, lon: 77.593, alt: 0, command: 'RTL', frame: 'relative', groundElevation: 100 }),
    ];
    const checked = validateMission(generated, { minTerrainClearance: 5 });
    expect(checked.warnings.some((w) => w.code === 'TERRAIN_UNCHECKED')).toBe(false);
    expect(checked.errors.some((e) => e.code === 'TERRAIN_CLEARANCE')).toBe(true);

    // The same pattern with no elevation lookup: the rule cannot run, and the
    // result says so instead of reporting the mission clean.
    const unsampled = generated.map((g) => ({ ...g, groundElevation: undefined }));
    const unchecked = validateMission(unsampled, { minTerrainClearance: 5 });
    expect(unchecked.errors.some((e) => e.code === 'TERRAIN_CLEARANCE')).toBe(false);
    // TAKEOFF and RTL are exempt; the two mid-mission waypoints report unchecked.
    expect(unchecked.warnings.filter((w) => w.code === 'TERRAIN_UNCHECKED')).toHaveLength(2);
  });
});

describe('validateMission — newly added dangerous conditions', () => {
  it('blocks DUPLICATE_SEQUENCE when two rows share an id', () => {
    const shared = wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF' });
    const result = validateMission([shared, { ...shared, lat: 12.98, command: 'LAND' }]);
    expect(result.errors.some((e) => e.code === 'DUPLICATE_SEQUENCE')).toBe(true);
  });

  it('flags UNREACHABLE_JUMP_TARGET for a jump into the region after the mission ends', () => {
    const orphan = wp({ lat: 12.99, lon: 77.61, command: 'WAYPOINT' });
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF' }),
      wp({
        lat: 12.98, lon: 77.60, command: 'LAND',
        actions: [{ id: 'a1', command: 'DO_JUMP', jumpTargetId: orphan.id, param2: 1 }],
      }),
      orphan,
    ]);
    expect(result.warnings.some((w) => w.code === 'UNREACHABLE_JUMP_TARGET')).toBe(true);
  });

  it('blocks RTL_ALTITUDE_LOW when the return cruise does not clear the highest sampled terrain', () => {
    const mission = [
      wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF', frame: 'terrain', groundElevation: 100 }),
      wp({ lat: 12.98, lon: 77.60, alt: 80, command: 'WAYPOINT', frame: 'terrain', groundElevation: 220 }),
      wp({ lat: 12.99, lon: 77.61, alt: 0, command: 'RTL', frame: 'terrain', groundElevation: 100 }),
    ];
    // Cruise = 100 (home ground) + 60 = 160m MSL, against 220m MSL terrain.
    const low = validateMission(mission, { rtlAltitude: 60, minTerrainClearance: 5 });
    expect(low.errors.some((e) => e.code === 'RTL_ALTITUDE_LOW')).toBe(true);

    // 150m above home clears 220m MSL by 30m.
    const safe = validateMission(mission, { rtlAltitude: 150, minTerrainClearance: 5 });
    expect(safe.errors.some((e) => e.code === 'RTL_ALTITUDE_LOW')).toBe(false);
  });

  it('flags a leg and a waypoint that exceed the configured link range', () => {
    const result = validateMission(
      [
        wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'TAKEOFF' }),
        wp({ lat: 13.30, lon: 77.59, command: 'LAND' }), // ~36 km away
      ],
      { linkRangeM: 5000 },
    );
    expect(result.warnings.some((w) => w.code === 'LEG_EXCEEDS_LINK_RANGE')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'OUTSIDE_LINK_RANGE')).toBe(true);
  });

  it('flags TURN_RADIUS_TOO_TIGHT for a hairpin a fixed wing cannot fly', () => {
    // Out 200m east, then straight back west: a 180-degree reversal, which no
    // finite turn radius fits.
    const hairpin = validateMission(
      [
        wp({ lat: 12.97, lon: 77.5900, alt: 0, command: 'TAKEOFF' }),
        wp({ lat: 12.97, lon: 77.5918, command: 'WAYPOINT' }),
        wp({ lat: 12.97, lon: 77.5900, command: 'LAND' }),
      ],
      { vehicle: { minTurnRadiusM: 60 } },
    );
    expect(hairpin.warnings.some((w) => w.code === 'TURN_RADIUS_TOO_TIGHT')).toBe(true);

    // A gentle dogleg over long legs fits comfortably inside 60m.
    const gentle = validateMission(
      [
        wp({ lat: 12.9700, lon: 77.5900, alt: 0, command: 'TAKEOFF' }),
        wp({ lat: 12.9700, lon: 77.6000, command: 'WAYPOINT' }),
        wp({ lat: 12.9705, lon: 77.6100, command: 'LAND' }),
      ],
      { vehicle: { minTurnRadiusM: 60 } },
    );
    expect(gentle.warnings.some((w) => w.code === 'TURN_RADIUS_TOO_TIGHT')).toBe(false);
  });

  it('labels every issue with a severity that matches the bucket it lands in', () => {
    const result = validateMission([
      wp({ lat: 91, lon: 77.59, alt: 60, command: 'WAYPOINT' }),
      wp({ lat: 12.98, lon: 77.60, command: 'WAYPOINT' }),
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.errors.every((e) => e.severity === 'blocking')).toBe(true);
    expect(result.warnings.every((w) => w.severity === 'advisory')).toBe(true);
  });
});
