import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMissionStore } from '@/stores/mission-store';
import { clearHistory } from '@/lib/planner-history';
import type { Waypoint } from '@/lib/types';
import type { MissionItem } from '@/lib/protocol/types';
import { useUploadReceiptsStore, receiptFor, receiptStatus } from '@/stores/upload-receipts-store';
import { missionContentHash } from '@/lib/mission-upload';
import { mspDownloadMission } from '@/lib/protocol/msp-adapter-commands';
import { inavDownloadMission } from '@/lib/protocol/msp-adapter/inav/mission';
import { INAV_MSP } from '@/lib/protocol/msp/msp-decoders-inav';
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue';

// A per-test-controllable selected protocol. `null` (the default) exercises the
// no-connection early-return; a stub lets a test observe the flattened upload and
// serve items back for the re-nesting download.
let mockProtocol: {
  uploadMission: (items: MissionItem[]) => Promise<{ success: boolean }>;
  downloadMission: () => Promise<MissionItem[]>;
  getVehicleInfo: () => { firmwareType: string } | null;
} | null = null;

// Mock dependencies
vi.mock('@/stores/drone-manager', () => ({
  useDroneManager: {
    // The stub protocol is drone "d1", the selected drone.
    getState: () => ({
      getSelectedProtocol: () => mockProtocol,
      selectedDroneId: mockProtocol ? 'd1' : null,
      drones: new Map(mockProtocol ? [['d1', { protocol: mockProtocol }]] : []),
    }),
    setState: vi.fn(),
  },
}));
vi.mock('@/stores/planner-store', () => ({
  usePlannerStore: {
    getState: () => ({ defaultFrame: 'relative' }),
    setState: vi.fn(),
  },
}));
vi.mock('@/lib/storage', () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

function makeWaypoint(overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    id: Math.random().toString(36).slice(2, 10),
    lat: 12.97,
    lon: 77.59,
    alt: 50,
    ...overrides,
  };
}

describe('mission-store', () => {
  beforeEach(() => {
    mockProtocol = null;
    useMissionStore.setState({
      activeMission: null,
      waypoints: [],
      progress: 0,
      currentWaypoint: 0,
      uploadState: 'idle',
      downloadState: 'idle',
    });
    // Undo/redo now lives in the shared coordinated timeline; drop it so each
    // test starts from a clean history.
    clearHistory();
    useUploadReceiptsStore.setState({ receipts: {} });
  });

  it('initial state has empty waypoints', () => {
    const state = useMissionStore.getState();
    expect(state.waypoints).toEqual([]);
    expect(state.activeMission).toBeNull();
    expect(state.uploadState).toBe('idle');
  });

  it('addWaypoint() appends waypoint', () => {
    const wp = makeWaypoint({ id: 'wp-1' });
    useMissionStore.getState().addWaypoint(wp);

    const state = useMissionStore.getState();
    expect(state.waypoints).toHaveLength(1);
    expect(state.waypoints[0].id).toBe('wp-1');
  });

  it('removeWaypoint() removes by ID', () => {
    const wp1 = makeWaypoint({ id: 'wp-1' });
    const wp2 = makeWaypoint({ id: 'wp-2' });
    useMissionStore.getState().addWaypoint(wp1);
    useMissionStore.getState().addWaypoint(wp2);

    expect(useMissionStore.getState().waypoints).toHaveLength(2);

    useMissionStore.getState().removeWaypoint('wp-1');
    const state = useMissionStore.getState();
    expect(state.waypoints).toHaveLength(1);
    expect(state.waypoints[0].id).toBe('wp-2');
  });

  it('updateWaypoint() modifies specific waypoint', () => {
    const wp = makeWaypoint({ id: 'wp-1', alt: 50 });
    useMissionStore.getState().addWaypoint(wp);

    useMissionStore.getState().updateWaypoint('wp-1', { alt: 100 });

    const updated = useMissionStore.getState().waypoints[0];
    expect(updated.alt).toBe(100);
    expect(updated.lat).toBe(12.97); // unchanged
  });

  it('reorderWaypoints() changes order', () => {
    const wp1 = makeWaypoint({ id: 'wp-1' });
    const wp2 = makeWaypoint({ id: 'wp-2' });
    const wp3 = makeWaypoint({ id: 'wp-3' });

    useMissionStore.getState().addWaypoint(wp1);
    useMissionStore.getState().addWaypoint(wp2);
    useMissionStore.getState().addWaypoint(wp3);

    // Move wp-3 (index 2) to index 0
    useMissionStore.getState().reorderWaypoints(2, 0);

    const ids = useMissionStore.getState().waypoints.map((w) => w.id);
    expect(ids).toEqual(['wp-3', 'wp-1', 'wp-2']);
  });

  it('clearMission() resets to empty', () => {
    const wp = makeWaypoint({ id: 'wp-1' });
    useMissionStore.getState().addWaypoint(wp);
    useMissionStore.getState().createMission('Test Mission', 'drone-1');

    useMissionStore.getState().clearMission();

    const state = useMissionStore.getState();
    expect(state.waypoints).toEqual([]);
    expect(state.activeMission).toBeNull();
    expect(state.progress).toBe(0);
    expect(state.uploadState).toBe('idle');
  });

  it('undo/redo works for addWaypoint', () => {
    const wp1 = makeWaypoint({ id: 'wp-1' });
    const wp2 = makeWaypoint({ id: 'wp-2' });

    useMissionStore.getState().addWaypoint(wp1);
    useMissionStore.getState().addWaypoint(wp2);

    expect(useMissionStore.getState().waypoints).toHaveLength(2);

    // Undo last add
    useMissionStore.getState().undo();
    expect(useMissionStore.getState().waypoints).toHaveLength(1);
    expect(useMissionStore.getState().waypoints[0].id).toBe('wp-1');

    // Redo
    useMissionStore.getState().redo();
    expect(useMissionStore.getState().waypoints).toHaveLength(2);
  });

  it('undo does nothing when stack is empty', () => {
    expect(useMissionStore.getState().waypoints).toEqual([]);
    useMissionStore.getState().undo();
    expect(useMissionStore.getState().waypoints).toEqual([]);
  });

  it('createMission sets up a new mission', () => {
    useMissionStore.getState().createMission('Survey Alpha', 'drone-1');

    const state = useMissionStore.getState();
    expect(state.activeMission).not.toBeNull();
    expect(state.activeMission?.name).toBe('Survey Alpha');
    expect(state.activeMission?.droneId).toBe('drone-1');
    expect(state.waypoints).toEqual([]);
  });

  it('insertWaypoint() inserts at specific index', () => {
    const wp1 = makeWaypoint({ id: 'wp-1' });
    const wp2 = makeWaypoint({ id: 'wp-2' });
    const wpInserted = makeWaypoint({ id: 'wp-mid' });

    useMissionStore.getState().addWaypoint(wp1);
    useMissionStore.getState().addWaypoint(wp2);
    useMissionStore.getState().insertWaypoint(wpInserted, 1);

    const ids = useMissionStore.getState().waypoints.map((w) => w.id);
    expect(ids).toEqual(['wp-1', 'wp-mid', 'wp-2']);
  });

  it('uploadMission() flattens attached actions into a contiguous seq item list', async () => {
    let uploaded: MissionItem[] = [];
    mockProtocol = {
      uploadMission: async (items) => {
        uploaded = items;
        return { success: true };
      },
      downloadMission: async () => [],
      getVehicleInfo: () => ({ firmwareType: 'px4' }),
    };

    useMissionStore.setState({
      waypoints: [
        makeWaypoint({ id: 'wp-0', command: 'TAKEOFF' }),
        makeWaypoint({
          id: 'wp-1',
          command: 'WAYPOINT',
          actions: [
            { id: 'a1', command: 'DO_SET_SPEED', param2: 5 },
            { id: 'a2', command: 'CONDITION_YAW', param1: 90 },
          ],
        }),
        makeWaypoint({
          id: 'wp-2',
          command: 'LAND',
          actions: [{ id: 'a3', command: 'DO_JUMP', jumpTargetId: 'wp-1', param2: 2 }],
        }),
      ],
    });

    const ok = await useMissionStore.getState().uploadMission();
    expect(ok).toBe(true);
    // 3 NAV + 3 actions, contiguously sequenced.
    expect(uploaded.map((it) => it.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    // The DO_JUMP (last item) resolved its target to wp-1's flattened seq (1).
    const jump = uploaded[5];
    expect(jump.command).toBe(177); // MAV_CMD_DO_JUMP
    expect(jump.param1).toBe(1); // target seq
    expect(jump.param2).toBe(2); // repeat count
  });

  it('downloadMission() re-nests action items under their navigation waypoint', async () => {
    // A flat FC item list: TAKEOFF, WAYPOINT + DO_SET_SPEED, LAND.
    const items: MissionItem[] = [
      { seq: 0, frame: 3, command: 22, current: 1, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 129700000, y: 775900000, z: 30 },
      { seq: 1, frame: 3, command: 16, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 129800000, y: 776000000, z: 50 },
      { seq: 2, frame: 3, command: 178, current: 0, autocontinue: 1, param1: 0, param2: 8, param3: 0, param4: 0, x: 0, y: 0, z: 0 },
      { seq: 3, frame: 3, command: 21, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 129900000, y: 776100000, z: 0 },
    ];
    mockProtocol = {
      uploadMission: async () => ({ success: true }),
      downloadMission: async () => items,
      getVehicleInfo: () => ({ firmwareType: 'px4' }),
    };

    const waypoints = await useMissionStore.getState().downloadMission();
    // 3 NAV waypoints; the DO_SET_SPEED folded into the middle waypoint's actions.
    expect(waypoints.map((w) => w.command)).toEqual(['TAKEOFF', 'WAYPOINT', 'LAND']);
    expect(waypoints[1].actions).toHaveLength(1);
    expect(waypoints[1].actions?.[0].command).toBe('DO_SET_SPEED');
    expect(useMissionStore.getState().downloadState).toBe('downloaded');
  });

  // An ArduPilot mission: TAKEOFF 30 m, WP A, WP B carrying DO_JUMP → A ×2, RTL.
  function arduPilotPlan(): Waypoint[] {
    return [
      makeWaypoint({ id: 't', command: 'TAKEOFF', alt: 30 }),
      makeWaypoint({ id: 'a', command: 'WAYPOINT', lat: 12.98 }),
      makeWaypoint({
        id: 'b', command: 'WAYPOINT', lat: 12.99,
        actions: [{ id: 'j', command: 'DO_JUMP', jumpTargetId: 'a', param2: 2 }],
      }),
      makeWaypoint({ id: 'r', command: 'RTL', lat: 0, lon: 0, alt: 0 }),
    ];
  }

  it('uploadMission() to ArduPilot writes home at seq 0 and starts the mission at seq 1', async () => {
    let uploaded: MissionItem[] = [];
    mockProtocol = {
      uploadMission: async (items) => {
        uploaded = items;
        return { success: true };
      },
      downloadMission: async () => [],
      getVehicleInfo: () => ({ firmwareType: 'ardupilot-copter' }),
    };
    useMissionStore.setState({ waypoints: arduPilotPlan() });

    expect(await useMissionStore.getState().uploadMission()).toBe(true);
    // No HOME_POSITION received: the slot takes the first waypoint at 0 m.
    expect(uploaded[0]).toMatchObject({ seq: 0, command: 16, frame: 0, current: 0, z: 0 });
    expect(uploaded[0].x).toBe(Math.round(12.97 * 1e7));
    expect(uploaded[1]).toMatchObject({ seq: 1, command: 22, z: 30 });
    const jump = uploaded.find((it) => it.command === 177);
    expect(jump?.param1).toBe(2); // WP A sits at seq 2
    expect(uploaded.every((it, i) => it.seq === i)).toBe(true);
  });

  it('downloadMission() from ArduPilot drops the home slot and keeps TAKEOFF first', async () => {
    mockProtocol = {
      uploadMission: async () => ({ success: true }),
      downloadMission: async () => [],
      getVehicleInfo: () => ({ firmwareType: 'ardupilot-copter' }),
    };
    useMissionStore.setState({ waypoints: arduPilotPlan() });
    let onVehicle: MissionItem[] = [];
    mockProtocol.uploadMission = async (items) => {
      onVehicle = items;
      return { success: true };
    };
    await useMissionStore.getState().uploadMission();
    mockProtocol.downloadMission = async () => onVehicle;

    const waypoints = await useMissionStore.getState().downloadMission();
    expect(waypoints.map((w) => w.command)).toEqual(['TAKEOFF', 'WAYPOINT', 'WAYPOINT', 'RTL']);
    const jump = waypoints[2].actions?.[0];
    expect(jump?.command === 'DO_JUMP' ? jump.jumpTargetId : undefined).toBe(waypoints[1].id);
    expect(useMissionStore.getState().downloadWarnings).toEqual([]);
  });

  it('downloadMission() names a leading item it cannot attach to a waypoint', async () => {
    mockProtocol = {
      uploadMission: async () => ({ success: true }),
      downloadMission: async () => [
        { seq: 0, frame: 2, command: 181, current: 0, autocontinue: 1, param1: 1, param2: 1, param3: 0, param4: 0, x: 0, y: 0, z: 0 },
        { seq: 1, frame: 3, command: 16, current: 1, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 129700000, y: 775900000, z: 30 },
      ],
      getVehicleInfo: () => ({ firmwareType: 'px4' }),
    };
    const waypoints = await useMissionStore.getState().downloadMission();
    expect(waypoints).toHaveLength(1);
    expect(useMissionStore.getState().downloadWarnings).toEqual([
      expect.stringContaining('MAV_CMD 181'),
    ]);
  });

  // ── Upload receipts ──────────────────────────────────────

  function stubArduPilot(upload: () => Promise<{ success: boolean }> = async () => ({ success: true })) {
    mockProtocol = {
      uploadMission: upload,
      downloadMission: async () => [],
      getVehicleInfo: () => ({ firmwareType: 'ardupilot-copter' }),
    };
  }

  function missionStatus() {
    return receiptStatus(
      receiptFor('mission', 'd1'),
      missionContentHash(useMissionStore.getState().waypoints),
    );
  }

  it('a confirmed upload reads as on aircraft until the plan is edited', async () => {
    stubArduPilot();
    useMissionStore.setState({ waypoints: arduPilotPlan() });
    await useMissionStore.getState().uploadMission();
    expect(missionStatus()).toBe('on-aircraft');

    useMissionStore.getState().updateWaypoint('a', { lat: 13.01 });
    expect(missionStatus()).toBe('older-on-aircraft');
    // Another drone never inherits this drone's upload.
    expect(receiptFor('mission', 'd2')).toBeUndefined();
  });

  it('a failed upload leaves no receipt, even over an earlier good one', async () => {
    stubArduPilot();
    useMissionStore.setState({ waypoints: arduPilotPlan() });
    await useMissionStore.getState().uploadMission();
    stubArduPilot(async () => ({ success: false }));
    expect(await useMissionStore.getState().uploadMission()).toBe(false);
    expect(missionStatus()).toBe('unknown');
  });

  it('MISSION_CURRENT maps ArduPilot seq onto planner waypoints past the home slot', async () => {
    stubArduPilot();
    useMissionStore.setState({ waypoints: arduPilotPlan() });
    await useMissionStore.getState().uploadMission();
    const at = (seq: number) => {
      useMissionStore.getState().applyMissionCurrent('d1', seq);
      return useMissionStore.getState().currentWaypoint;
    };
    expect(at(1)).toBe(0); // TAKEOFF
    expect(at(4)).toBe(2); // B's DO_JUMP belongs to B
    expect(at(5)).toBe(3); // RTL
    expect(at(0)).toBeNull(); // the home slot is not a planner waypoint
  });

  it('MISSION_CURRENT reads as unknown without a matching receipt', async () => {
    stubArduPilot();
    useMissionStore.setState({ waypoints: arduPilotPlan() });
    useMissionStore.getState().applyMissionCurrent('d1', 1);
    expect(useMissionStore.getState().currentWaypoint).toBeNull();

    await useMissionStore.getState().uploadMission();
    useMissionStore.getState().updateWaypoint('a', { lat: 13.01 });
    useMissionStore.getState().applyMissionCurrent('d1', 1);
    expect(useMissionStore.getState().currentWaypoint).toBeNull();
    expect(useMissionStore.getState().progress).toBe(0);
  });

  it('a clean download vouches for the plan it loaded', async () => {
    let onVehicle: MissionItem[] = [];
    mockProtocol = {
      uploadMission: async (items) => {
        onVehicle = items;
        return { success: true };
      },
      downloadMission: async () => onVehicle,
      getVehicleInfo: () => ({ firmwareType: 'ardupilot-copter' }),
    };
    useMissionStore.setState({ waypoints: arduPilotPlan() });
    await useMissionStore.getState().uploadMission();
    // A reconnect forgets what this GCS uploaded; the download re-learns it.
    useUploadReceiptsStore.setState({ receipts: {} });

    await useMissionStore.getState().downloadMission();
    expect(missionStatus()).toBe('on-aircraft');
    useMissionStore.getState().applyMissionCurrent('d1', 1);
    expect(useMissionStore.getState().currentWaypoint).toBe(0);
  });

  it('a download that dropped an item does not vouch for the plan', async () => {
    mockProtocol = {
      uploadMission: async () => ({ success: true }),
      downloadMission: async () => [
        { seq: 0, frame: 2, command: 181, current: 0, autocontinue: 1, param1: 1, param2: 1, param3: 0, param4: 0, x: 0, y: 0, z: 0 },
        { seq: 1, frame: 3, command: 16, current: 1, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 129700000, y: 775900000, z: 30 },
      ],
      getVehicleInfo: () => ({ firmwareType: 'px4' }),
    };
    await useMissionStore.getState().downloadMission();
    expect(missionStatus()).toBe('unknown');
  });

  it('a failed download keeps the local plan', async () => {
    const plan = arduPilotPlan();
    useMissionStore.setState({ waypoints: plan });
    mockProtocol = {
      uploadMission: async () => ({ success: true }),
      downloadMission: async () => { throw new Error('MISSION_ITEM_INT timeout'); },
      getVehicleInfo: () => ({ firmwareType: 'ardupilot-copter' }),
    };
    await useMissionStore.getState().downloadMission();
    expect(useMissionStore.getState().downloadState).toBe('error');
    expect(useMissionStore.getState().waypoints).toEqual(plan);
  });

  it('an MSP firmware with no mission store rejects the download instead of returning an empty mission', async () => {
    await expect(mspDownloadMission()).rejects.toThrow(/not supported/i);
  });

  it('an iNav read that fails part-way rejects instead of returning a short mission', async () => {
    // WP_GETINFO reports 3 waypoints, then the first MSP_WP read times out.
    const info = new Uint8Array([0, 3, 1, 0]);
    const queue = {
      send: vi.fn(async (cmd: number) => {
        if (cmd === INAV_MSP.MSP_WP_GETINFO) return { payload: info };
        throw new Error('MSP_WP timeout');
      }),
    } as unknown as MspSerialQueue;
    await expect(inavDownloadMission(queue)).rejects.toThrow('MSP_WP timeout');
    await expect(inavDownloadMission(null)).rejects.toThrow(/not connected/i);
  });
});

