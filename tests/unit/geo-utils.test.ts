import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  bearing,
  polygonArea,
  polygonCentroid,
  pointInPolygon,
  offsetPoint,
  polygonBounds,
  isConvex,
  isSelfIntersecting,
} from '@/lib/drawing/geo-utils';
import { BANGALORE, CHENNAI, BANGALORE_POLYGON } from '../helpers/geo-fixtures';

describe('haversineDistance()', () => {
  it('between Bangalore and Chennai is ~290km (tolerance +/-5km)', () => {
    const dist = haversineDistance(BANGALORE[0], BANGALORE[1], CHENNAI[0], CHENNAI[1]);
    expect(dist).toBeGreaterThan(285_000);
    expect(dist).toBeLessThan(295_000);
  });

  it('returns 0 for same point', () => {
    const dist = haversineDistance(12.97, 77.59, 12.97, 77.59);
    expect(dist).toBe(0);
  });
});

describe('bearing()', () => {
  it('north is ~0 degrees', () => {
    // Point directly north of Bangalore
    const b = bearing(12.97, 77.59, 13.97, 77.59);
    expect(b).toBeCloseTo(0, 0);
  });

  it('east is ~90 degrees', () => {
    const b = bearing(12.97, 77.59, 12.97, 78.59);
    expect(b).toBeCloseTo(90, 0);
  });

  it('south is ~180 degrees', () => {
    const b = bearing(12.97, 77.59, 11.97, 77.59);
    expect(b).toBeCloseTo(180, 0);
  });
});

describe('polygonArea()', () => {
  it('returns 0 for fewer than 3 vertices', () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([[0, 0]])).toBe(0);
    expect(polygonArea([[0, 0], [1, 1]])).toBe(0);
  });

  it('computes known rectangle area', () => {
    // BANGALORE_POLYGON is roughly 0.01 deg lat x 0.01 deg lon
    // At latitude 12.97: 0.01 deg lat ~ 1113m, 0.01 deg lon ~ 1085m
    // Area ~ 1113 * 1085 ~ 1.21 million m^2
    const area = polygonArea(BANGALORE_POLYGON);
    expect(area).toBeGreaterThan(1_000_000);
    expect(area).toBeLessThan(1_400_000);
  });
});

describe('polygonCentroid()', () => {
  it('of a symmetric polygon is the center', () => {
    const centroid = polygonCentroid(BANGALORE_POLYGON);
    expect(centroid[0]).toBeCloseTo(12.975, 3);
    expect(centroid[1]).toBeCloseTo(77.595, 3);
  });
});

describe('pointInPolygon()', () => {
  it('correctly identifies inside points', () => {
    // Center of BANGALORE_POLYGON
    expect(pointInPolygon([12.975, 77.595], BANGALORE_POLYGON)).toBe(true);
  });

  it('correctly identifies outside points', () => {
    // Well outside the polygon
    expect(pointInPolygon([13.0, 77.595], BANGALORE_POLYGON)).toBe(false);
    expect(pointInPolygon([12.975, 77.5], BANGALORE_POLYGON)).toBe(false);
  });

  it('on vertex or edge (edge case)', () => {
    // Ray casting vertex/edge behavior is implementation-defined.
    // Just verify it returns a boolean without crashing.
    const result = pointInPolygon([12.97, 77.59], BANGALORE_POLYGON);
    expect(typeof result).toBe('boolean');
  });
});

describe('offsetPoint()', () => {
  it('by 0 distance returns same point', () => {
    const [lat, lon] = offsetPoint(12.97, 77.59, 0, 0);
    expect(lat).toBeCloseTo(12.97, 6);
    expect(lon).toBeCloseTo(77.59, 6);
  });

  it('north increases latitude', () => {
    const [lat] = offsetPoint(12.97, 77.59, 0, 1000); // 1km north
    expect(lat).toBeGreaterThan(12.97);
  });

  it('east increases longitude', () => {
    const [, lon] = offsetPoint(12.97, 77.59, 90, 1000); // 1km east
    expect(lon).toBeGreaterThan(77.59);
  });
});

describe('polygonBounds()', () => {
  it('computes correct min/max', () => {
    const bounds = polygonBounds(BANGALORE_POLYGON);
    expect(bounds.minLat).toBe(12.97);
    expect(bounds.maxLat).toBe(12.98);
    expect(bounds.minLon).toBe(77.59);
    expect(bounds.maxLon).toBe(77.60);
  });
});

describe('isConvex()', () => {
  it('returns true for convex polygon', () => {
    expect(isConvex(BANGALORE_POLYGON)).toBe(true);
  });

  it('returns false for concave L-shape', () => {
    // L-shaped polygon (concave)
    const lShape: [number, number][] = [
      [0, 0],
      [0, 2],
      [1, 2],
      [1, 1],
      [2, 1],
      [2, 0],
    ];
    expect(isConvex(lShape)).toBe(false);
  });
});

describe('isSelfIntersecting()', () => {
  it('returns true for bowtie', () => {
    // Bowtie shape: edges cross
    const bowtie: [number, number][] = [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ];
    expect(isSelfIntersecting(bowtie)).toBe(true);
  });

  it('returns false for simple square', () => {
    const square: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(isSelfIntersecting(square)).toBe(false);
  });
});
