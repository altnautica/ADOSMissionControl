import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock jurisdiction module before importing the store
vi.mock('@/lib/jurisdiction', () => ({
  JURISDICTIONS: {
    dgca: { name: 'DGCA', country: 'India' },
    faa: { name: 'FAA', country: 'USA' },
  } as Record<string, any>,
}));

import { useAirspaceStore } from '@/stores/airspace-store';
import type { AirspaceZone } from '@/lib/airspace/types';

function makeZone(overrides: Partial<AirspaceZone> = {}): AirspaceZone {
  return {
    id: 'zone-1',
    name: 'Test Zone',
    type: 'classB',
    geometry: { type: 'Polygon', coordinates: [[[77.5, 12.9], [77.6, 12.9], [77.6, 13.0], [77.5, 13.0], [77.5, 12.9]]] },
    floorAltitude: 0,
    ceilingAltitude: 3000,
    authority: 'DGCA',
    metadata: {},
    ...overrides,
  };
}

describe('airspace-store', () => {
  beforeEach(() => {
    useAirspaceStore.getState().clear();
  });

  it('initial state has empty zones', () => {
    const state = useAirspaceStore.getState();
    expect(state.zones).toEqual([]);
    expect(state.notams).toEqual([]);
    expect(state.tfrs).toEqual([]);
    expect(state.flyability).toBeNull();
    expect(state.operationalAltitude).toBe(120);
  });

  it('setZones() populates zones', () => {
    const z1 = makeZone({ id: 'z1', name: 'Zone Alpha' });
    const z2 = makeZone({ id: 'z2', name: 'Zone Bravo', type: 'restricted' });

    useAirspaceStore.getState().setZones([z1, z2]);

    const state = useAirspaceStore.getState();
    expect(state.zones).toHaveLength(2);
    expect(state.zones[0].name).toBe('Zone Alpha');
    expect(state.zones[1].type).toBe('restricted');
  });

  it('layer visibility toggles work', () => {
    const initial = useAirspaceStore.getState().layerVisibility;
    expect(initial.airspace).toBe(true);
    expect(initial.heatmap).toBe(false);

    // Toggle airspace off
    useAirspaceStore.getState().setLayerVisibility('airspace', false);
    expect(useAirspaceStore.getState().layerVisibility.airspace).toBe(false);
    // Other layers unchanged
    expect(useAirspaceStore.getState().layerVisibility.restrictions).toBe(true);

    // Toggle heatmap on
    useAirspaceStore.getState().setLayerVisibility('heatmap', true);
    expect(useAirspaceStore.getState().layerVisibility.heatmap).toBe(true);
  });

  it('operational altitude updates correctly', () => {
    expect(useAirspaceStore.getState().operationalAltitude).toBe(120);

    useAirspaceStore.getState().setOperationalAltitude(400);
    expect(useAirspaceStore.getState().operationalAltitude).toBe(400);
  });

  it('setJurisdiction() updates jurisdiction', () => {
    expect(useAirspaceStore.getState().jurisdiction).toBeNull();

    useAirspaceStore.getState().setJurisdiction('dgca');
    expect(useAirspaceStore.getState().jurisdiction).toBe('dgca');
  });

  it('toggleJurisdiction() adds and removes jurisdictions', () => {
    const initial = useAirspaceStore.getState().activeJurisdictions;
    const hasDgca = initial.has('dgca');

    useAirspaceStore.getState().toggleJurisdiction('dgca');
    const afterToggle = useAirspaceStore.getState().activeJurisdictions;
    expect(afterToggle.has('dgca')).toBe(!hasDgca);
  });

  it('setSelectedPoint() stores coordinates', () => {
    expect(useAirspaceStore.getState().selectedPoint).toBeNull();

    useAirspaceStore.getState().setSelectedPoint({ lat: 12.97, lon: 77.59 });
    expect(useAirspaceStore.getState().selectedPoint).toEqual({ lat: 12.97, lon: 77.59 });

    useAirspaceStore.getState().setSelectedPoint(null);
    expect(useAirspaceStore.getState().selectedPoint).toBeNull();
  });

  it('setAltitudeFilter() updates filter range', () => {
    useAirspaceStore.getState().setAltitudeFilter({ min: 100, max: 5000 });
    const filter = useAirspaceStore.getState().altitudeFilter;
    expect(filter.min).toBe(100);
    expect(filter.max).toBe(5000);
  });

  it('loading and error states work', () => {
    expect(useAirspaceStore.getState().loading).toBe(false);
    expect(useAirspaceStore.getState().error).toBeNull();

    useAirspaceStore.getState().setLoading(true);
    expect(useAirspaceStore.getState().loading).toBe(true);

    useAirspaceStore.getState().setError('Network timeout');
    expect(useAirspaceStore.getState().error).toBe('Network timeout');

    useAirspaceStore.getState().setError(null);
    expect(useAirspaceStore.getState().error).toBeNull();
  });

  it('clear() resets to initial state', () => {
    useAirspaceStore.getState().setZones([makeZone()]);
    useAirspaceStore.getState().setOperationalAltitude(500);
    useAirspaceStore.getState().setLoading(true);
    useAirspaceStore.getState().setError('test');

    useAirspaceStore.getState().clear();

    const state = useAirspaceStore.getState();
    expect(state.zones).toEqual([]);
    expect(state.operationalAltitude).toBe(120);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('setNotams() and setTfrs() populate correctly', () => {
    useAirspaceStore.getState().setNotams([
      { id: 'n1', title: 'Test NOTAM', text: 'Details', issuer: 'DGCA', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' },
    ]);
    expect(useAirspaceStore.getState().notams).toHaveLength(1);

    useAirspaceStore.getState().setTfrs([
      {
        id: 'tfr1', name: 'Temporary', type: 'tfr',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        floorAltitude: 0, ceilingAltitude: 1000, validFrom: '2026-01-01',
        validTo: '2026-12-31', authority: 'FAA', description: 'Test TFR',
      },
    ]);
    expect(useAirspaceStore.getState().tfrs).toHaveLength(1);
  });
});
