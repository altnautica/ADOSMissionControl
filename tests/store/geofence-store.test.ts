import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/stores/drone-manager', () => ({
  useDroneManager: {
    getState: vi.fn(() => ({
      getSelectedProtocol: () => null,
    })),
  },
}));

import { useGeofenceStore } from '@/stores/geofence-store';

describe('geofence-store', () => {
  beforeEach(() => {
    useGeofenceStore.getState().clearFence();
  });

  // ------- Initial state -------
  it('has correct initial state', () => {
    const s = useGeofenceStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.fenceType).toBe('circle');
    expect(s.maxAltitude).toBe(120);
    expect(s.minAltitude).toBe(0);
    expect(s.breachAction).toBe('RTL');
    expect(s.circleCenter).toBeNull();
    expect(s.circleRadius).toBe(200);
    expect(s.polygonPoints).toEqual([]);
    expect(s.uploadState).toBe('idle');
    expect(s.downloadState).toBe('idle');
    expect(s.zones).toEqual([]);
    expect(s.breachStatus).toBe(0);
    expect(s.breachCount).toBe(0);
    expect(s.breachType).toBe(0);
  });

  // ------- Simple setters -------
  it('setEnabled', () => {
    useGeofenceStore.getState().setEnabled(true);
    expect(useGeofenceStore.getState().enabled).toBe(true);
  });

  it('setFenceType', () => {
    useGeofenceStore.getState().setFenceType('polygon');
    expect(useGeofenceStore.getState().fenceType).toBe('polygon');
  });

  it('setMaxAltitude', () => {
    useGeofenceStore.getState().setMaxAltitude(250);
    expect(useGeofenceStore.getState().maxAltitude).toBe(250);
  });

  it('setMinAltitude', () => {
    useGeofenceStore.getState().setMinAltitude(10);
    expect(useGeofenceStore.getState().minAltitude).toBe(10);
  });

  it('setBreachAction', () => {
    useGeofenceStore.getState().setBreachAction('LAND');
    expect(useGeofenceStore.getState().breachAction).toBe('LAND');
  });

  // ------- Geometry -------
  it('setCircle updates center and radius', () => {
    useGeofenceStore.getState().setCircle([12.97, 77.59], 500);
    const s = useGeofenceStore.getState();
    expect(s.circleCenter).toEqual([12.97, 77.59]);
    expect(s.circleRadius).toBe(500);
  });

  it('setPolygonPoints updates points', () => {
    const pts: [number, number][] = [[12.97, 77.59], [12.98, 77.60], [12.99, 77.59]];
    useGeofenceStore.getState().setPolygonPoints(pts);
    expect(useGeofenceStore.getState().polygonPoints).toEqual(pts);
  });

  // ------- Map draw sync -------
  it('syncFromMapDraw converts latLngs and sets polygon mode', () => {
    useGeofenceStore.getState().syncFromMapDraw([
      { lat: 12.97, lng: 77.59 },
      { lat: 12.98, lng: 77.60 },
      { lat: 12.99, lng: 77.59 },
    ]);
    const s = useGeofenceStore.getState();
    expect(s.fenceType).toBe('polygon');
    expect(s.enabled).toBe(true);
    expect(s.polygonPoints).toEqual([
      [12.97, 77.59],
      [12.98, 77.60],
      [12.99, 77.59],
    ]);
  });

  it('syncCircleFromMapDraw converts center and enables', () => {
    useGeofenceStore.getState().syncCircleFromMapDraw({ lat: 12.97, lng: 77.59 }, 300);
    const s = useGeofenceStore.getState();
    expect(s.fenceType).toBe('circle');
    expect(s.enabled).toBe(true);
    expect(s.circleCenter).toEqual([12.97, 77.59]);
    expect(s.circleRadius).toBe(300);
  });

  // ------- Zones -------
  it('addZone adds with generated ID', () => {
    useGeofenceStore.getState().addZone({
      role: 'inclusion',
      type: 'polygon',
      polygonPoints: [[1, 2], [3, 4], [5, 6]],
      circleCenter: null,
      circleRadius: 0,
    });
    const zones = useGeofenceStore.getState().zones;
    expect(zones).toHaveLength(1);
    expect(zones[0].id).toMatch(/^zone-/);
    expect(zones[0].role).toBe('inclusion');
  });

  it('removeZone removes by ID', () => {
    useGeofenceStore.getState().addZone({
      role: 'inclusion',
      type: 'circle',
      polygonPoints: [],
      circleCenter: [12, 77],
      circleRadius: 100,
    });
    const id = useGeofenceStore.getState().zones[0].id;
    useGeofenceStore.getState().removeZone(id);
    expect(useGeofenceStore.getState().zones).toHaveLength(0);
  });

  it('updateZonePolygon updates specific zone', () => {
    useGeofenceStore.getState().addZone({
      role: 'inclusion',
      type: 'polygon',
      polygonPoints: [[1, 2]],
      circleCenter: null,
      circleRadius: 0,
    });
    const id = useGeofenceStore.getState().zones[0].id;
    useGeofenceStore.getState().updateZonePolygon(id, [[10, 20], [30, 40], [50, 60]]);
    expect(useGeofenceStore.getState().zones[0].polygonPoints).toEqual([[10, 20], [30, 40], [50, 60]]);
  });

  it('updateZoneCircle updates specific zone', () => {
    useGeofenceStore.getState().addZone({
      role: 'exclusion',
      type: 'circle',
      polygonPoints: [],
      circleCenter: [0, 0],
      circleRadius: 50,
    });
    const id = useGeofenceStore.getState().zones[0].id;
    useGeofenceStore.getState().updateZoneCircle(id, [12, 77], 999);
    const z = useGeofenceStore.getState().zones[0];
    expect(z.circleCenter).toEqual([12, 77]);
    expect(z.circleRadius).toBe(999);
  });

  it('toggleZoneRole switches inclusion to exclusion and back', () => {
    useGeofenceStore.getState().addZone({
      role: 'inclusion',
      type: 'polygon',
      polygonPoints: [],
      circleCenter: null,
      circleRadius: 0,
    });
    const id = useGeofenceStore.getState().zones[0].id;
    useGeofenceStore.getState().toggleZoneRole(id);
    expect(useGeofenceStore.getState().zones[0].role).toBe('exclusion');
    useGeofenceStore.getState().toggleZoneRole(id);
    expect(useGeofenceStore.getState().zones[0].role).toBe('inclusion');
  });

  // ------- Breach state -------
  it('updateBreachState updates breach fields', () => {
    useGeofenceStore.getState().updateBreachState(1, 3, 2);
    const s = useGeofenceStore.getState();
    expect(s.breachStatus).toBe(1);
    expect(s.breachCount).toBe(3);
    expect(s.breachType).toBe(2);
  });

  // ------- Clear -------
  it('clearFence resets everything to defaults', () => {
    useGeofenceStore.getState().setEnabled(true);
    useGeofenceStore.getState().setCircle([12, 77], 500);
    useGeofenceStore.getState().setPolygonPoints([[1, 2]]);
    useGeofenceStore.getState().addZone({
      role: 'inclusion',
      type: 'polygon',
      polygonPoints: [],
      circleCenter: null,
      circleRadius: 0,
    });
    useGeofenceStore.getState().updateBreachState(1, 5, 3);

    useGeofenceStore.getState().clearFence();
    const s = useGeofenceStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.circleCenter).toBeNull();
    expect(s.circleRadius).toBe(200);
    expect(s.polygonPoints).toEqual([]);
    expect(s.zones).toEqual([]);
    expect(s.uploadState).toBe('idle');
    expect(s.downloadState).toBe('idle');
    expect(s.breachStatus).toBe(0);
    expect(s.breachCount).toBe(0);
    expect(s.breachType).toBe(0);
  });

  // ------- Upload / Download with no protocol -------
  it('uploadFence with no protocol returns without error', async () => {
    await expect(useGeofenceStore.getState().uploadFence()).resolves.toBeUndefined();
  });

  it('downloadFence with no protocol returns without error', async () => {
    await expect(useGeofenceStore.getState().downloadFence()).resolves.toBeUndefined();
  });

  // ------- Multiple zones -------
  it('multiple zones tracked independently', () => {
    useGeofenceStore.getState().addZone({
      role: 'inclusion',
      type: 'polygon',
      polygonPoints: [[1, 2]],
      circleCenter: null,
      circleRadius: 0,
    });
    useGeofenceStore.getState().addZone({
      role: 'exclusion',
      type: 'circle',
      polygonPoints: [],
      circleCenter: [10, 20],
      circleRadius: 100,
    });
    const zones = useGeofenceStore.getState().zones;
    expect(zones).toHaveLength(2);
    expect(zones[0].role).toBe('inclusion');
    expect(zones[1].role).toBe('exclusion');
    expect(zones[0].id).not.toBe(zones[1].id);
  });
});
