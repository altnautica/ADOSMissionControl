import { describe, it, expect } from 'vitest';
import {
  computeCPA,
  classifyThreat,
  haversineDistance,
  computeAllThreats,
} from '@/lib/airspace/threat-calculator';
import type { AircraftState } from '@/lib/airspace/types';

/** Helper to build a partial AircraftState with defaults. */
function makeAircraft(overrides: Partial<AircraftState> & { lat: number; lon: number }): AircraftState {
  return {
    icao24: 'ABCDEF',
    callsign: 'TEST123',
    originCountry: 'India',
    altitudeMsl: 500,
    altitudeAgl: null,
    velocity: null,
    heading: null,
    verticalRate: null,
    lastSeen: Date.now(),
    squawk: null,
    category: 0,
    ...overrides,
  };
}

describe('computeCPA()', () => {
  it('converging aircraft has small CPA distance', () => {
    // Aircraft 2km east, heading west (270 degrees) at 100 m/s
    const ac = makeAircraft({
      lat: 12.97,
      lon: 77.61,         // ~2km east of drone
      altitudeMsl: 100,
      velocity: 100,
      heading: 270,       // heading west toward drone
    });

    const cpa = computeCPA(12.97, 77.59, 100, ac);
    // CPA distance should be much less than current distance
    const currentDist = haversineDistance(12.97, 77.59, 12.97, 77.61);
    expect(cpa.distanceM).toBeLessThan(currentDist);
    expect(cpa.timeS).toBeGreaterThan(0);
  });

  it('diverging aircraft has CPA equal to current distance', () => {
    // Aircraft 2km east, heading east (90 degrees) — moving away
    const ac = makeAircraft({
      lat: 12.97,
      lon: 77.61,
      altitudeMsl: 100,
      velocity: 100,
      heading: 90,        // heading east, away from drone
    });

    const cpa = computeCPA(12.97, 77.59, 100, ac);
    // CPA time should be 0 (clamped) since aircraft is diverging
    expect(cpa.timeS).toBe(0);
    // CPA distance should be approximately the current distance
    const currentDist = haversineDistance(12.97, 77.59, 12.97, 77.61);
    expect(cpa.distanceM).toBeCloseTo(currentDist, -2);
  });

  it('zero velocity aircraft CPA is current distance', () => {
    const ac = makeAircraft({
      lat: 12.975,
      lon: 77.595,
      altitudeMsl: 150,
      velocity: 0,
      heading: 0,
    });

    const cpa = computeCPA(12.97, 77.59, 100, ac);
    expect(cpa.timeS).toBe(0);
    // Should be roughly the 3D distance
    const horizDist = haversineDistance(12.97, 77.59, 12.975, 77.595);
    expect(cpa.distanceM).toBeGreaterThan(horizDist * 0.9);
  });

  it('null velocity aircraft CPA is current 3D distance', () => {
    const ac = makeAircraft({
      lat: 12.975,
      lon: 77.595,
      altitudeMsl: 200,
      velocity: null,
      heading: null,
    });

    const cpa = computeCPA(12.97, 77.59, 100, ac);
    expect(cpa.timeS).toBe(0);
    expect(cpa.distanceM).toBeGreaterThan(0);
  });
});

describe('classifyThreat()', () => {
  it('RA for close CPA and short time', () => {
    expect(classifyThreat({ distanceM: 300, timeS: 15 })).toBe('ra');
  });

  it('TA for medium CPA and moderate time', () => {
    expect(classifyThreat({ distanceM: 1000, timeS: 45 })).toBe('ta');
  });

  it('proximate for far CPA', () => {
    expect(classifyThreat({ distanceM: 2500, timeS: 90 })).toBe('proximate');
  });

  it('other for distant aircraft', () => {
    expect(classifyThreat({ distanceM: 5000, timeS: 120 })).toBe('other');
  });
});

describe('computeAllThreats()', () => {
  it('processes multiple aircraft and returns assessments', () => {
    const aircraft: AircraftState[] = [
      makeAircraft({ icao24: 'A1', lat: 12.975, lon: 77.595, velocity: 100, heading: 270, altitudeMsl: 100 }),
      makeAircraft({ icao24: 'A2', lat: 14.0, lon: 78.0, velocity: 200, heading: 180, altitudeMsl: 5000 }),
    ];

    const threats = computeAllThreats(12.97, 77.59, 100, aircraft);
    expect(threats.length).toBe(2);
    expect(threats[0].icao24).toBe('A1');
    expect(threats[1].icao24).toBe('A2');
    // Each has required fields
    for (const t of threats) {
      expect(['ra', 'ta', 'proximate', 'other']).toContain(t.level);
      expect(typeof t.cpaDistance).toBe('number');
      expect(typeof t.cpaTime).toBe('number');
      expect(typeof t.altitudeDelta).toBe('number');
    }
  });

  it('empty aircraft list returns empty threats', () => {
    const threats = computeAllThreats(12.97, 77.59, 100, []);
    expect(threats).toHaveLength(0);
  });
});

describe('computeCPA edge cases', () => {
  it('same position gives CPA distance near 0', () => {
    const ac = makeAircraft({
      lat: 12.97,
      lon: 77.59,
      altitudeMsl: 100,
      velocity: 0,
      heading: 0,
    });
    const cpa = computeCPA(12.97, 77.59, 100, ac);
    // Distance should be very small (just altitude delta if any)
    expect(cpa.distanceM).toBeLessThan(10);
  });

  it('high altitude aircraft has large altitude delta in threat', () => {
    const ac = makeAircraft({
      lat: 12.975,
      lon: 77.595,
      altitudeMsl: 10000,
      velocity: 200,
      heading: 270,
    });
    const threats = computeAllThreats(12.97, 77.59, 100, [ac]);
    expect(threats[0].altitudeDelta).toBeGreaterThan(9000);
  });

  it('stationary aircraft CPA equals current position', () => {
    const ac = makeAircraft({
      lat: 12.975,
      lon: 77.595,
      altitudeMsl: 100,
      velocity: 0,
      heading: 90,
    });
    const cpa = computeCPA(12.97, 77.59, 100, ac);
    expect(cpa.timeS).toBe(0);
    const currentDist = haversineDistance(12.97, 77.59, 12.975, 77.595);
    expect(cpa.distanceM).toBeGreaterThanOrEqual(currentDist * 0.9);
  });
});

describe('classifyThreat edge cases', () => {
  it('exactly at RA boundary', () => {
    // RA is CPA < 500m AND time < 30s
    const level = classifyThreat({ distanceM: 499, timeS: 29 });
    expect(level).toBe('ra');
  });

  it('CPA is 0 meters classifies as RA', () => {
    expect(classifyThreat({ distanceM: 0, timeS: 5 })).toBe('ra');
  });

  it('very large CPA distance classifies as other', () => {
    expect(classifyThreat({ distanceM: 100000, timeS: 300 })).toBe('other');
  });
});
