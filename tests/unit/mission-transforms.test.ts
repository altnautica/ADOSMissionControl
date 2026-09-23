import { describe, it, expect } from 'vitest';
import {
  moveMission,
  moveMissionByBearing,
  rotateMission,
  rotateMissionAroundPoint,
  scaleMission,
  scaleMissionFromPoint,
  mirrorMission,
} from '@/lib/transforms/mission-transforms';
import type { CommandMissionAction, Waypoint } from '@/lib/types/mission';

function wp(lat: number, lon: number, extra?: Partial<Waypoint>): Waypoint {
  return {
    id: Math.random().toString(36).slice(2, 10),
    lat,
    lon,
    alt: 50,
    command: 'WAYPOINT',
    ...extra,
  };
}

const sampleWaypoints: Waypoint[] = [
  wp(12.970, 77.590, { id: 'a', alt: 30, command: 'TAKEOFF' }),
  wp(12.975, 77.595, { id: 'b', alt: 50 }),
  wp(12.980, 77.600, { id: 'c', alt: 40, command: 'LAND' }),
];

describe('moveMission', () => {
  it('shifts all waypoints by delta', () => {
    const moved = moveMission(sampleWaypoints, 0.01, 0.02);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(moved[i].lat).toBeCloseTo(sampleWaypoints[i].lat + 0.01, 8);
      expect(moved[i].lon).toBeCloseTo(sampleWaypoints[i].lon + 0.02, 8);
    }
  });

  it('preserves altitude and other properties', () => {
    const moved = moveMission(sampleWaypoints, 0.01, 0.02);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(moved[i].alt).toBe(sampleWaypoints[i].alt);
      expect(moved[i].id).toBe(sampleWaypoints[i].id);
      expect(moved[i].command).toBe(sampleWaypoints[i].command);
    }
  });

  it('returns empty array for empty input', () => {
    expect(moveMission([], 1, 1)).toEqual([]);
  });

  it('returns a NEW array (non-mutating)', () => {
    const moved = moveMission(sampleWaypoints, 0.01, 0.02);
    expect(moved).not.toBe(sampleWaypoints);
    expect(moved[0]).not.toBe(sampleWaypoints[0]);
  });
});

describe('moveMissionByBearing', () => {
  it('moves all waypoints by bearing and distance', () => {
    const moved = moveMissionByBearing(sampleWaypoints, 0, 1000); // 1km north
    for (let i = 0; i < sampleWaypoints.length; i++) {
      // Moved north means lat increased
      expect(moved[i].lat).toBeGreaterThan(sampleWaypoints[i].lat);
      // Lon should stay roughly the same (bearing=0 is due north)
      expect(moved[i].lon).toBeCloseTo(sampleWaypoints[i].lon, 3);
    }
  });
});

describe('rotateMission', () => {
  it('returns approximately same positions for 0 degree rotation', () => {
    const rotated = rotateMission(sampleWaypoints, 0);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(rotated[i].lat).toBeCloseTo(sampleWaypoints[i].lat, 6);
      expect(rotated[i].lon).toBeCloseTo(sampleWaypoints[i].lon, 6);
    }
  });

  it('flips positions around centroid for 180 degree rotation', () => {
    const rotated = rotateMission(sampleWaypoints, 180);
    // Centroid
    const cLat = sampleWaypoints.reduce((s, w) => s + w.lat, 0) / sampleWaypoints.length;
    const cLon = sampleWaypoints.reduce((s, w) => s + w.lon, 0) / sampleWaypoints.length;
    // After 180 degree rotation, each point should be reflected through the centroid
    for (let i = 0; i < sampleWaypoints.length; i++) {
      const expectedLat = 2 * cLat - sampleWaypoints[i].lat;
      const expectedLon = 2 * cLon - sampleWaypoints[i].lon;
      expect(rotated[i].lat).toBeCloseTo(expectedLat, 4);
      expect(rotated[i].lon).toBeCloseTo(expectedLon, 4);
    }
  });

  it('returns empty array for empty input', () => {
    expect(rotateMission([], 90)).toEqual([]);
  });

  it('preserves waypoint id/alt/command properties', () => {
    const rotated = rotateMission(sampleWaypoints, 45);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(rotated[i].id).toBe(sampleWaypoints[i].id);
      expect(rotated[i].alt).toBe(sampleWaypoints[i].alt);
      expect(rotated[i].command).toBe(sampleWaypoints[i].command);
    }
  });

  it('returns a NEW array (non-mutating)', () => {
    const rotated = rotateMission(sampleWaypoints, 45);
    expect(rotated).not.toBe(sampleWaypoints);
  });
});

describe('scaleMission', () => {
  it('returns approximately same positions for factor 1', () => {
    const scaled = scaleMission(sampleWaypoints, 1);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(scaled[i].lat).toBeCloseTo(sampleWaypoints[i].lat, 8);
      expect(scaled[i].lon).toBeCloseTo(sampleWaypoints[i].lon, 8);
    }
  });

  it('doubles distances from centroid for factor 2', () => {
    const cLat = sampleWaypoints.reduce((s, w) => s + w.lat, 0) / sampleWaypoints.length;
    const cLon = sampleWaypoints.reduce((s, w) => s + w.lon, 0) / sampleWaypoints.length;
    const scaled = scaleMission(sampleWaypoints, 2);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      const expectedLat = cLat + (sampleWaypoints[i].lat - cLat) * 2;
      const expectedLon = cLon + (sampleWaypoints[i].lon - cLon) * 2;
      expect(scaled[i].lat).toBeCloseTo(expectedLat, 8);
      expect(scaled[i].lon).toBeCloseTo(expectedLon, 8);
    }
  });

  it('returns empty array for empty input', () => {
    expect(scaleMission([], 2)).toEqual([]);
  });

  it('preserves waypoint id/alt/command properties', () => {
    const scaled = scaleMission(sampleWaypoints, 2);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(scaled[i].id).toBe(sampleWaypoints[i].id);
      expect(scaled[i].alt).toBe(sampleWaypoints[i].alt);
      expect(scaled[i].command).toBe(sampleWaypoints[i].command);
    }
  });

  it('returns a NEW array (non-mutating)', () => {
    const scaled = scaleMission(sampleWaypoints, 2);
    expect(scaled).not.toBe(sampleWaypoints);
  });
});

describe('mirrorMission', () => {
  it('reflects longitudes about the centroid and leaves latitudes untouched (axis "lat")', () => {
    const cLat = sampleWaypoints.reduce((s, w) => s + w.lat, 0) / sampleWaypoints.length;
    const cLon = sampleWaypoints.reduce((s, w) => s + w.lon, 0) / sampleWaypoints.length;
    const mirrored = mirrorMission(sampleWaypoints, 'lat');
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(mirrored[i].lat).toBeCloseTo(sampleWaypoints[i].lat, 10);
      expect(mirrored[i].lon).toBeCloseTo(2 * cLon - sampleWaypoints[i].lon, 10);
    }
    // Centroid is invariant under mirroring.
    const mcLon = mirrored.reduce((s, w) => s + w.lon, 0) / mirrored.length;
    expect(mcLon).toBeCloseTo(cLon, 10);
  });

  it('reflects latitudes about the centroid and leaves longitudes untouched (axis "lon")', () => {
    const cLat = sampleWaypoints.reduce((s, w) => s + w.lat, 0) / sampleWaypoints.length;
    const mirrored = mirrorMission(sampleWaypoints, 'lon');
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(mirrored[i].lon).toBeCloseTo(sampleWaypoints[i].lon, 10);
      expect(mirrored[i].lat).toBeCloseTo(2 * cLat - sampleWaypoints[i].lat, 10);
    }
  });

  it('is its own inverse when applied twice', () => {
    const twice = mirrorMission(mirrorMission(sampleWaypoints, 'lat'), 'lat');
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(twice[i].lat).toBeCloseTo(sampleWaypoints[i].lat, 10);
      expect(twice[i].lon).toBeCloseTo(sampleWaypoints[i].lon, 10);
    }
  });

  it('returns empty array for empty input', () => {
    expect(mirrorMission([], 'lat')).toEqual([]);
  });

  it('preserves waypoint id/alt/command properties and does not mutate', () => {
    const mirrored = mirrorMission(sampleWaypoints, 'lat');
    expect(mirrored).not.toBe(sampleWaypoints);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(mirrored[i].id).toBe(sampleWaypoints[i].id);
      expect(mirrored[i].alt).toBe(sampleWaypoints[i].alt);
      expect(mirrored[i].command).toBe(sampleWaypoints[i].command);
    }
  });
});

describe('rotateMissionAroundPoint', () => {
  it('reflects each point through an explicit center for 180 degree rotation', () => {
    const centerLat = 12.9;
    const centerLon = 77.5;
    const rotated = rotateMissionAroundPoint(sampleWaypoints, 180, centerLat, centerLon);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(rotated[i].lat).toBeCloseTo(2 * centerLat - sampleWaypoints[i].lat, 4);
      expect(rotated[i].lon).toBeCloseTo(2 * centerLon - sampleWaypoints[i].lon, 4);
    }
  });

  it('turns clockwise on a north-up map: a point due north lands due east at +90', () => {
    const north = [wp(0.001, 0, { id: 'n' })];
    const [r] = rotateMissionAroundPoint(north, 90, 0, 0);
    expect(r.lat).toBeCloseTo(0, 8);
    expect(r.lon).toBeCloseTo(0.001, 8);
  });

  it('leaves positions unchanged for 0 degree rotation about any point', () => {
    const rotated = rotateMissionAroundPoint(sampleWaypoints, 0, 0, 0);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(rotated[i].lat).toBeCloseTo(sampleWaypoints[i].lat, 8);
      expect(rotated[i].lon).toBeCloseTo(sampleWaypoints[i].lon, 8);
    }
  });
});

describe('scaleMissionFromPoint', () => {
  it('doubles distances from an explicit center for factor 2', () => {
    const centerLat = 12.9;
    const centerLon = 77.5;
    const scaled = scaleMissionFromPoint(sampleWaypoints, 2, centerLat, centerLon);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(scaled[i].lat).toBeCloseTo(centerLat + (sampleWaypoints[i].lat - centerLat) * 2, 8);
      expect(scaled[i].lon).toBeCloseTo(centerLon + (sampleWaypoints[i].lon - centerLon) * 2, 8);
    }
  });

  it('returns approximately same positions for factor 1', () => {
    const scaled = scaleMissionFromPoint(sampleWaypoints, 1, 12.9, 77.5);
    for (let i = 0; i < sampleWaypoints.length; i++) {
      expect(scaled[i].lat).toBeCloseTo(sampleWaypoints[i].lat, 8);
      expect(scaled[i].lon).toBeCloseTo(sampleWaypoints[i].lon, 8);
    }
  });
});

describe('positioned actions', () => {
  const withRoi: Waypoint[] = [
    wp(12.970, 77.590, { id: 'a', command: 'TAKEOFF' }),
    wp(12.975, 77.595, {
      id: 'b',
      actions: [
        { id: 'roi', command: 'ROI', lat: 12.976, lon: 77.596, alt: 0 },
        { id: 'delay', command: 'DELAY', param1: 3 },
      ],
    }),
  ];

  it('moves an ROI target with the mission', () => {
    const moved = moveMission(withRoi, 0.01, 0.02);
    const roi = moved[1].actions![0] as CommandMissionAction;
    expect(roi.lat).toBeCloseTo(12.986, 8);
    expect(roi.lon).toBeCloseTo(77.616, 8);
    expect(moved[1].actions![1]).toEqual(withRoi[1].actions![1]);
  });

  it('rotates an ROI target about the same pivot as the waypoints', () => {
    const [, b] = rotateMissionAroundPoint(withRoi, 90, 12.975, 77.595);
    const roi = b.actions![0] as CommandMissionAction;
    // 0.001 deg north-east of the pivot turns to south-east.
    expect(roi.lat).toBeLessThan(12.975);
    expect(roi.lon).toBeGreaterThan(77.595);
  });
});
