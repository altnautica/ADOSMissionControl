import { describe, it, expect, vi } from 'vitest';
import type {
  AirspaceZone,
  Notam,
  TemporaryRestriction,
} from '@/lib/airspace/types';

// Mock the airport-database module since it depends on cached data
vi.mock('@/lib/airspace/airport-database', () => ({
  getAirportsSync: () => [],
}));

// Import after mocking
const { assessFlyability } = await import('@/lib/airspace/flyability');

function makeCircleZone(
  type: AirspaceZone['type'],
  lat: number,
  lon: number,
  radiusM: number,
  overrides?: Partial<AirspaceZone>,
): AirspaceZone {
  return {
    id: Math.random().toString(36).slice(2),
    name: `Test ${type}`,
    type,
    geometry: { type: 'Polygon', coordinates: [] },
    floorAltitude: 0,
    ceilingAltitude: 120,
    authority: 'test',
    circle: { lat, lon, radiusM },
    metadata: {},
    ...overrides,
  };
}

describe('assessFlyability', () => {
  it('returns CLEAR for location outside all zones', () => {
    const result = assessFlyability(
      12.97, 77.59,
      [], // no zones
      [],
      [],
      null,
    );
    expect(result.verdict).toBe('clear');
  });

  it('returns ADVISORY for advisory zone (classC)', () => {
    const zone = makeCircleZone('classC', 12.97, 77.59, 10000);
    const result = assessFlyability(
      12.97, 77.59,
      [zone],
      [],
      [],
      'faa',
    );
    expect(result.verdict).toBe('advisory');
  });

  it('returns ADVISORY for DGCA yellow zone', () => {
    const zone = makeCircleZone('dgcaYellow', 12.97, 77.59, 10000, {
      ceilingAltitude: 60,
    });
    const result = assessFlyability(
      12.97, 77.59,
      [zone],
      [],
      [],
      'dgca',
    );
    expect(result.verdict).toBe('advisory');
    expect(result.maxAltitudeAgl).toBeLessThanOrEqual(60);
  });

  it('returns RESTRICTED for prohibited zone', () => {
    const zone = makeCircleZone('prohibited', 12.97, 77.59, 10000);
    const result = assessFlyability(
      12.97, 77.59,
      [zone],
      [],
      [],
      'faa',
    );
    expect(result.verdict).toBe('restricted');
    expect(result.maxAltitudeAgl).toBe(0);
  });

  it('returns RESTRICTED for DGCA red zone', () => {
    const zone = makeCircleZone('dgcaRed', 12.97, 77.59, 10000);
    const result = assessFlyability(
      12.97, 77.59,
      [zone],
      [],
      [],
      'dgca',
    );
    expect(result.verdict).toBe('restricted');
  });

  it('returns RESTRICTED when active TFRs are present', () => {
    const now = new Date();
    const tfr: TemporaryRestriction = {
      id: 'tfr-1',
      name: 'Test TFR',
      type: 'tfr',
      geometry: { type: 'Polygon', coordinates: [] },
      floorAltitude: 0,
      ceilingAltitude: 500,
      validFrom: new Date(now.getTime() - 3600000).toISOString(),
      validTo: new Date(now.getTime() + 3600000).toISOString(),
      authority: 'FAA',
      description: 'Test restriction',
    };
    const result = assessFlyability(
      12.97, 77.59,
      [],
      [],
      [tfr],
      'faa',
    );
    expect(result.verdict).toBe('restricted');
  });

  it('returns altitude constraint from overlapping zones', () => {
    const zone1 = makeCircleZone('classC', 12.97, 77.59, 10000, {
      ceilingAltitude: 120,
    });
    const zone2 = makeCircleZone('classD', 12.97, 77.59, 10000, {
      ceilingAltitude: 50,
    });
    const result = assessFlyability(
      12.97, 77.59,
      [zone1, zone2],
      [],
      [],
      'faa',
    );
    expect(result.verdict).toBe('advisory');
    expect(typeof result.maxAltitudeAgl).toBe('number');
  });

  it('expired TFR does not restrict', () => {
    const now = new Date();
    const expiredTfr: TemporaryRestriction = {
      id: 'tfr-expired',
      name: 'Expired TFR',
      type: 'tfr',
      geometry: { type: 'Polygon', coordinates: [] },
      floorAltitude: 0,
      ceilingAltitude: 500,
      validFrom: new Date(now.getTime() - 7200000).toISOString(),
      validTo: new Date(now.getTime() - 3600000).toISOString(),
      authority: 'FAA',
      description: 'Past restriction',
    };
    const result = assessFlyability(
      12.97, 77.59,
      [],
      [],
      [expiredTfr],
      'faa',
    );
    expect(result.verdict).not.toBe('restricted');
  });

  it('returns clear with no zones', () => {
    const result = assessFlyability(12.97, 77.59, [], [], [], 'dgca');
    expect(result.verdict).toBe('clear');
  });

  it('restricted zone sets maxAltitude to 0', () => {
    const zone = makeCircleZone('restricted', 12.97, 77.59, 10000);
    const result = assessFlyability(12.97, 77.59, [zone], [], [], 'faa');
    expect(result.maxAltitudeAgl).toBe(0);
  });

  it('includes guidance text in result', () => {
    const zone = makeCircleZone('classC', 12.97, 77.59, 10000);
    const result = assessFlyability(12.97, 77.59, [zone], [], [], 'faa');
    expect(result.guidance).toBeDefined();
    expect(result.guidance.length).toBeGreaterThan(0);
  });
});
