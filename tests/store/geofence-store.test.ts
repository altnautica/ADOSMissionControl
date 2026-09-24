import { describe, it, expect, beforeEach, vi } from 'vitest';

let selectedProtocol: Record<string, unknown> | null = null;
vi.mock('@/stores/drone-selection', () => ({
  droneSelection: () => ({ selectedDroneId: selectedProtocol ? 'd1' : null, drones: new Map() }),
  selectedDroneProtocol: () => selectedProtocol,
}));

import { useGeofenceStore, type BreachAction } from '@/stores/geofence-store';
import { useUploadReceiptsStore, receiptFor, receiptStatus } from '@/stores/upload-receipts-store';
import { fenceContentHash } from '@/lib/geofence-elements';

/** Point the mocked selection at a protocol (selected drone "d1") until the
 * next beforeEach. A default `getVehicleInfo` (ArduPilot) is supplied so
 * uploadFence takes the legacy FENCE_POINT path; a test can override it to
 * exercise the PX4 mission-fence branch. */
function stubProtocol(protocol: Record<string, unknown>) {
  const withDefaults = { getVehicleInfo: () => ({ firmwareType: "ardupilot" }), ...protocol };
  selectedProtocol = withDefaults;
}

/** Receipt status of the current fence content for drone "d1". */
function fenceStatus() {
  return receiptStatus(receiptFor("fence", "d1"), fenceContentHash(useGeofenceStore.getState().snapshot()));
}

/** A minimal triangle so uploadFence passes its >=3 point guard. */
const TRI: [number, number][] = [[12.97, 77.59], [12.98, 77.60], [12.99, 77.59]];

describe('geofence-store', () => {
  beforeEach(() => {
    useGeofenceStore.getState().clearFence();
    vi.clearAllMocks();
    selectedProtocol = null;
    useUploadReceiptsStore.setState({ receipts: {} });
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

  // ------- Upload writes the enforcing parameters -------
  it.each<[BreachAction, number]>([
    ['REPORT', 0],
    ['RTL', 1],
    ['LAND', 2],
  ])('uploadFence maps breachAction %s to FENCE_ACTION %i', async (action, value) => {
    const uploadFence = vi.fn().mockResolvedValue({ success: true });
    const setParameter = vi.fn().mockResolvedValue({ success: true });
    stubProtocol({ uploadFence, setParameter });

    const s = useGeofenceStore.getState();
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    s.setBreachAction(action);
    await s.uploadFence();

    expect(uploadFence).toHaveBeenCalledTimes(1);
    expect(setParameter).toHaveBeenCalledWith('FENCE_ACTION', value);
    expect(useGeofenceStore.getState().uploadState).toBe('uploaded');
  });

  it('ArduPilot upload enables the fence with the polygon and altitude-ceiling bits', async () => {
    const uploadFence = vi.fn().mockResolvedValue({ success: true });
    const setParameter = vi.fn().mockResolvedValue({ success: true });
    stubProtocol({ uploadFence, setParameter });

    const s = useGeofenceStore.getState();
    s.setEnabled(true);
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    s.setMaxAltitude(60);
    s.setMinAltitude(0);
    await s.uploadFence();

    expect(setParameter).toHaveBeenCalledWith('FENCE_TYPE', 5);
    expect(setParameter).toHaveBeenCalledWith('FENCE_ALT_MAX', 60);
    // Enabled last, once everything it enforces is configured.
    expect(setParameter.mock.calls.at(-1)).toEqual(['FENCE_ENABLE', 1]);
  });

  it('PX4 upload writes GF_MAX_VER_DIST and the GF_ACTION breach response', async () => {
    const uploadFenceMission = vi.fn().mockResolvedValue({ success: true });
    const setParameter = vi.fn().mockResolvedValue({ success: true });
    stubProtocol({
      uploadFence: vi.fn(),
      uploadFenceMission,
      setParameter,
      getVehicleInfo: () => ({ firmwareType: 'px4' }),
    });

    const s = useGeofenceStore.getState();
    s.setEnabled(true);
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    s.setMaxAltitude(80);
    s.setMinAltitude(0);
    s.setBreachAction('LAND');
    await s.uploadFence();

    expect(setParameter.mock.calls).toEqual([['GF_MAX_VER_DIST', 80], ['GF_ACTION', 5]]);
  });

  it('a failed fence parameter write fails the upload and vouches for nothing', async () => {
    const uploadFence = vi.fn().mockResolvedValue({ success: true });
    const setParameter = vi.fn().mockRejectedValue(new Error('no such param'));
    stubProtocol({ uploadFence, setParameter });

    const s = useGeofenceStore.getState();
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    const r = await s.uploadFence();

    expect(r.success).toBe(false);
    expect(r.message).toContain('FENCE_ACTION');
    expect(useGeofenceStore.getState().uploadState).toBe('error');
    expect(fenceStatus()).toBe('unknown');
  });

  it('does not write fence parameters when the geometry upload fails', async () => {
    const uploadFence = vi.fn().mockResolvedValue({ success: false });
    const setParameter = vi.fn().mockResolvedValue({ success: true });
    stubProtocol({ uploadFence, setParameter });

    const s = useGeofenceStore.getState();
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    await s.uploadFence();

    expect(setParameter).not.toHaveBeenCalled();
    expect(useGeofenceStore.getState().uploadState).toBe('error');
  });

  it('an edit after a confirmed upload stops reading as on aircraft', async () => {
    stubProtocol({
      uploadFence: vi.fn().mockResolvedValue({ success: true }),
      setParameter: vi.fn().mockResolvedValue({ success: true }),
    });
    const s = useGeofenceStore.getState();
    s.setEnabled(true);
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    await s.uploadFence();
    expect(fenceStatus()).toBe('on-aircraft');

    // A vertex drag on the map.
    useGeofenceStore.getState().setPolygonPoints([[12.97, 77.59], [12.98, 77.62], [12.99, 77.59]]);
    expect(fenceStatus()).toBe('older-on-aircraft');
    // A different drone has no receipt at all.
    expect(receiptFor('fence', 'd2')).toBeUndefined();
  });

  it('downloadFence takes enable, ceiling and action from the FC parameters', async () => {
    const params: Record<string, number> = { FENCE_ENABLE: 0, FENCE_ALT_MAX: 45, FENCE_ACTION: 2 };
    stubProtocol({
      uploadFence: vi.fn(),
      downloadFence: vi.fn().mockResolvedValue([
        { idx: 0, lat: 1, lon: 2 }, { idx: 1, lat: 1, lon: 3 }, { idx: 2, lat: 2, lon: 3 },
      ]),
      getParameter: vi.fn(async (name: string) => ({ name, value: params[name], type: 9, index: 0, count: 1 })),
    });
    const r = await useGeofenceStore.getState().downloadFence();
    const s = useGeofenceStore.getState();
    expect(r.success).toBe(true);
    expect(s.enabled).toBe(false);
    expect(s.maxAltitude).toBe(45);
    expect(s.breachAction).toBe('LAND');
    expect(fenceStatus()).toBe('on-aircraft');
  });

  it('a failed parameter read on download keeps the local fence', async () => {
    const s = useGeofenceStore.getState();
    s.setFenceType('polygon');
    s.setPolygonPoints(TRI);
    stubProtocol({
      uploadFence: vi.fn(),
      downloadFence: vi.fn().mockResolvedValue([
        { idx: 0, lat: 1, lon: 2 }, { idx: 1, lat: 1, lon: 3 }, { idx: 2, lat: 2, lon: 3 },
      ]),
      getParameter: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const r = await useGeofenceStore.getState().downloadFence();
    expect(r.success).toBe(false);
    expect(useGeofenceStore.getState().polygonPoints).toEqual(TRI);
    expect(useGeofenceStore.getState().downloadState).toBe('error');
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
