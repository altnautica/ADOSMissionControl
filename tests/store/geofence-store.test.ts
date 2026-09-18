import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/stores/drone-manager', () => ({
  useDroneManager: {
    getState: vi.fn(() => ({
      getSelectedProtocol: () => null,
    })),
  },
}));

import { useGeofenceStore, type BreachAction } from '@/stores/geofence-store';
import { useDroneManager } from '@/stores/drone-manager';

/** Point the mocked drone-manager at a protocol for a single upload call.
 * A default `getVehicleInfo` (ArduPilot) is supplied so uploadFence takes the
 * legacy FENCE_POINT + FENCE_ACTION path these tests assert; a test can override
 * it to exercise the PX4 mission-fence branch. */
function stubProtocolOnce(protocol: { uploadFence: unknown; setParameter?: unknown; getVehicleInfo?: unknown }) {
  const withDefaults = { getVehicleInfo: () => ({ firmwareType: "ardupilot" }), ...protocol };
  vi.mocked(useDroneManager.getState).mockReturnValueOnce({
    getSelectedProtocol: () => withDefaults,
  } as unknown as ReturnType<typeof useDroneManager.getState>);
}

/** A minimal triangle so uploadFence passes its >=3 point guard. */
const TRI: [number, number][] = [[12.97, 77.59], [12.98, 77.60], [12.99, 77.59]];

describe('geofence-store', () => {
  beforeEach(() => {
    useGeofenceStore.getState().clearFence();
    vi.clearAllMocks();
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
  it('uploadFence with no protocol reports the missing flight controller', async () => {
    await expect(useGeofenceStore.getState().uploadFence()).resolves.toEqual({
      success: false,
      message: 'No flight controller connected',
    });
  });

  // ------- Upload writes the breach action -------
  it.each<[BreachAction, number]>([
    ['REPORT', 0],
    ['RTL', 1],
    ['LAND', 2],
  ])('uploadFence maps breachAction %s to FENCE_ACTION %i', async (action, value) => {
    const uploadFence = vi.fn().mockResolvedValue({ success: true });
    const setParameter = vi.fn().mockResolvedValue({ success: true });
    stubProtocolOnce({ uploadFence, setParameter });

    const s = useGeofenceStore.getState();
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    s.setBreachAction(action);
    await s.uploadFence();

    expect(uploadFence).toHaveBeenCalledTimes(1);
    expect(setParameter).toHaveBeenCalledWith('FENCE_ACTION', value);
    expect(useGeofenceStore.getState().uploadState).toBe('uploaded');
  });

  it('a failed FENCE_ACTION write does not fail the committed geometry upload', async () => {
    const uploadFence = vi.fn().mockResolvedValue({ success: true });
    const setParameter = vi.fn().mockRejectedValue(new Error('no such param'));
    stubProtocolOnce({ uploadFence, setParameter });

    const s = useGeofenceStore.getState();
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    await s.uploadFence();

    // The geometry committed; the advisory param write failure is swallowed.
    expect(useGeofenceStore.getState().uploadState).toBe('uploaded');
  });

  it('does not write FENCE_ACTION when the geometry upload fails', async () => {
    const uploadFence = vi.fn().mockResolvedValue({ success: false });
    const setParameter = vi.fn().mockResolvedValue({ success: true });
    stubProtocolOnce({ uploadFence, setParameter });

    const s = useGeofenceStore.getState();
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    await s.uploadFence();

    expect(setParameter).not.toHaveBeenCalled();
    expect(useGeofenceStore.getState().uploadState).toBe('error');
  });

  it('downloadFence with no protocol reports the missing flight controller', async () => {
    await expect(useGeofenceStore.getState().downloadFence()).resolves.toEqual({
      success: false,
      message: 'No flight controller connected',
    });
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
