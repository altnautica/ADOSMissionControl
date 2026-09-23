import { describe, it, expect } from 'vitest';
import { generateOrbit } from '@/lib/patterns/orbit-generator';
import type { OrbitConfig } from '@/lib/patterns/types';

function makeConfig(overrides?: Partial<OrbitConfig>): OrbitConfig {
  return {
    center: [12.97, 77.59],
    radius: 100,
    direction: 'cw',
    turns: 1,
    startAngle: 0,
    altitude: 50,
    speed: 5,
    ...overrides,
  };
}

// Approximate haversine for small distances in meters
function approxDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

describe('generateOrbit', () => {
  it('aims the ROI at the target height, not the flight altitude', () => {
    for (const [targetHeight, expected] of [[undefined, 0], [12, 12]] as const) {
      const roi = generateOrbit(makeConfig({ altitude: 50, targetHeight })).waypoints.find((w) => w.command === 'ROI');
      expect(roi?.alt).toBe(expected);
    }
  });

  it('generates correct number of waypoints for given turns', () => {
    const result = generateOrbit(makeConfig({ radius: 100, turns: 1 }));
    // First waypoint is ROI, rest are orbit points
    const orbitPoints = result.waypoints.filter((w) => w.command === 'WAYPOINT');
    expect(orbitPoints.length).toBeGreaterThanOrEqual(8); // min 8 per turn
  });

  it('all waypoints are approximately at the specified radius from center', () => {
    const config = makeConfig({ radius: 200 });
    const result = generateOrbit(config);
    const orbitPoints = result.waypoints.filter((w) => w.command === 'WAYPOINT');
    for (const wp of orbitPoints) {
      const dist = approxDistanceM(config.center[0], config.center[1], wp.lat, wp.lon);
      // Allow 5% tolerance on radius due to geodetic approximation
      expect(dist).toBeGreaterThan(200 * 0.95);
      expect(dist).toBeLessThan(200 * 1.05);
    }
  });

  it('CW and CCW produce different orderings', () => {
    const cw = generateOrbit(makeConfig({ direction: 'cw' }));
    const ccw = generateOrbit(makeConfig({ direction: 'ccw' }));
    const cwPoints = cw.waypoints.filter((w) => w.command === 'WAYPOINT');
    const ccwPoints = ccw.waypoints.filter((w) => w.command === 'WAYPOINT');
    // At least one waypoint position should differ
    const differs = cwPoints.some(
      (p, i) => i < ccwPoints.length && (
        Math.abs(p.lat - ccwPoints[i].lat) > 1e-8 ||
        Math.abs(p.lon - ccwPoints[i].lon) > 1e-8
      ),
    );
    expect(differs).toBe(true);
  });

  it('waypoints form a circle (distance from center is consistent)', () => {
    const config = makeConfig({ radius: 150, turns: 1 });
    const result = generateOrbit(config);
    const orbitPoints = result.waypoints.filter((w) => w.command === 'WAYPOINT');
    const distances = orbitPoints.map((wp) =>
      approxDistanceM(config.center[0], config.center[1], wp.lat, wp.lon),
    );
    const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
    // All distances should be within 5% of the mean
    for (const d of distances) {
      expect(Math.abs(d - meanDist) / meanDist).toBeLessThan(0.05);
    }
  });
});
