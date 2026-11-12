import { describe, it, expect } from 'vitest';
import { buildValidationOptions, type ValidationOptionsSnapshot } from '@/hooks/use-validation-options';
import { validateMission } from '@/lib/validation/mission-validator';

const base: ValidationOptionsSnapshot = {
  enabled: true,
  fenceType: 'polygon',
  maxAltitude: 0,
  minAltitude: 0,
  polygonPoints: [],
  circleCenter: null,
  circleRadius: 0,
  zones: [],
  rallyPoints: [],
  defaultFrame: 'relative',
  defaultSpeed: 5,
  homeCircleRadiusM: null,
  plannedHome: null,
  profile: { autopilot: 'ardupilot', vehicleClass: 'copter' },
};

describe('buildValidationOptions', () => {
  it('validates against the planned home and its ground', () => {
    const options = buildValidationOptions({ ...base, plannedHome: { lat: 12.97, lon: 77.59, groundAmsl: 412 } });
    expect(options.home).toEqual({ lat: 12.97, lon: 77.59, groundElevation: 412 });
    expect(buildValidationOptions(base).home).toBeUndefined();
  });

  it('passes the profile and default speed through', () => {
    const options = buildValidationOptions({ ...base, profile: { autopilot: 'px4', vehicleClass: 'plane' } });
    expect(options.profile).toEqual({ autopilot: 'px4', vehicleClass: 'plane' });
    expect(options.defaultSpeed).toBe(5);
    expect(buildValidationOptions({ ...base, profile: null }).profile).toBeUndefined();
  });

  it('enforces the home circle fence only while the fence is enabled', () => {
    expect(buildValidationOptions({ ...base, homeCircleRadiusM: 300 }).homeCircleRadiusM).toBe(300);
    expect(buildValidationOptions({ ...base, enabled: false, homeCircleRadiusM: 300 }).homeCircleRadiusM).toBeUndefined();
  });
});

describe('altitude ceiling advisory', () => {
  it("takes the jurisdiction's ceiling, 120 m when none is set, with the fence off", () => {
    expect(buildValidationOptions({ ...base, enabled: false }).advisoryCeiling).toBe(120);
    expect(buildValidationOptions({ ...base, jurisdiction: 'faa' }).advisoryCeiling).toBe(122);
    expect(buildValidationOptions({ ...base, jurisdiction: 'casa' }).advisoryCeiling).toBe(120);
  });

  it('flags a waypoint over the ceiling as advisory, without a fence, once', () => {
    const options = buildValidationOptions({ ...base, enabled: false });
    const result = validateMission(
      [
        { id: 'a', lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' },
        { id: 'b', lat: 12.971, lon: 77.59, alt: 500, command: 'WAYPOINT' },
      ],
      options,
    );
    const hits = result.warnings.filter((w) => w.code === 'ALTITUDE_ABOVE_LIMIT');
    expect(hits).toHaveLength(1);
    expect(hits[0].waypointIndex).toBe(1);
    expect(result.errors.some((e) => e.code === 'ALTITUDE_ABOVE_LIMIT')).toBe(false);
  });

  it('does not repeat a waypoint the fence ceiling already blocks', () => {
    const options = buildValidationOptions({ ...base, maxAltitude: 100 });
    const result = validateMission([{ id: 'b', lat: 12.971, lon: 77.59, alt: 500, command: 'WAYPOINT' }], options);
    expect(result.errors.some((e) => e.code === 'ALTITUDE_EXCEEDED')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'ALTITUDE_ABOVE_LIMIT')).toBe(false);
  });
});
