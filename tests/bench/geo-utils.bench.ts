import { describe, bench } from 'vitest';
import { polygonArea, bearing, offsetPoint } from '@/lib/drawing/geo-utils';
import { haversineDistance, pointInPolygon } from "@/lib/geo/distance";

const polygon: [number, number][] = [
  [12.97, 77.59], [12.97, 77.60], [12.98, 77.60], [12.98, 77.59],
];

describe('Geo Utils Benchmarks', () => {
  bench('haversineDistance 10000 calls', () => {
    for (let i = 0; i < 10000; i++) {
      haversineDistance(12.9716, 77.5946, 13.0827, 80.2707);
    }
  });

  bench('pointInPolygon 10000 calls', () => {
    for (let i = 0; i < 10000; i++) {
      pointInPolygon([12.975, 77.595], polygon);
    }
  });

  bench('polygonArea 10000 calls', () => {
    for (let i = 0; i < 10000; i++) {
      polygonArea(polygon);
    }
  });

  bench('bearing 10000 calls', () => {
    for (let i = 0; i < 10000; i++) {
      bearing(12.9716, 77.5946, 13.0827, 80.2707);
    }
  });

  bench('offsetPoint 10000 calls', () => {
    for (let i = 0; i < 10000; i++) {
      offsetPoint(12.9716, 77.5946, 45, 1000);
    }
  });
});
