import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// The domain stores pull in drone-manager; stub it so no real protocol is hit.
vi.mock('@/stores/drone-manager', () => ({
  useDroneManager: {
    getState: () => ({ getSelectedProtocol: () => null }),
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

// Importing mission-store registers the waypoint adapter as a side effect, so it
// must be imported for the unified timeline to span waypoints.
import { useMissionStore } from '@/stores/mission-store';
import { useGeofenceStore } from '@/stores/geofence-store';
import { useRallyStore } from '@/stores/rally-store';
import { useDrawingStore } from '@/stores/drawing-store';
import { usePlannerHistoryStore } from '@/stores/planner-history-store';
import { clearHistory, recordHistory, undoDepth, redoDepth } from '@/lib/planner-history';
import type { Waypoint } from '@/lib/types';
import type { DrawnPolygon } from '@/lib/drawing/types';

function makeWaypoint(overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    id: Math.random().toString(36).slice(2, 10),
    lat: 12.97,
    lon: 77.59,
    alt: 50,
    ...overrides,
  };
}

function makePolygon(id: string): DrawnPolygon {
  return { id, vertices: [[1, 2], [3, 4], [5, 6]], area: 100 };
}

function resetAll() {
  // Reset all four domain stores to empty, then drop the shared timeline so each
  // test starts from a clean, isolated history.
  useMissionStore.setState({
    activeMission: null,
    waypoints: [],
    progress: 0,
    currentWaypoint: 0,
    uploadState: 'idle',
    downloadState: 'idle',
  });
  useGeofenceStore.getState().clearFence();
  useRallyStore.getState().clearPoints();
  useDrawingStore.getState().clearAll();
  clearHistory();
}

describe('planner-history (coordinated undo/redo)', () => {
  beforeEach(() => {
    resetAll();
  });

  // ---- Batch edit = one undo entry ----
  it('batchUpdateWaypoints records exactly ONE undo entry for N waypoints', () => {
    const ids = ['a', 'b', 'c', 'd'];
    for (const id of ids) useMissionStore.getState().addWaypoint(makeWaypoint({ id, alt: 50 }));

    expect(undoDepth()).toBe(ids.length); // one per add

    const depthBefore = undoDepth();
    useMissionStore.getState().batchUpdateWaypoints(ids, { alt: 120 });

    // The whole batch is one entry, not four.
    expect(undoDepth()).toBe(depthBefore + 1);
    for (const wp of useMissionStore.getState().waypoints) expect(wp.alt).toBe(120);

    // A single undo reverts the entire batch.
    useMissionStore.getState().undo();
    for (const wp of useMissionStore.getState().waypoints) expect(wp.alt).toBe(50);
  });

  it('batchUpdateWaypoints with an empty id list records nothing', () => {
    useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'a' }));
    const depthBefore = undoDepth();
    useMissionStore.getState().batchUpdateWaypoints([], { alt: 999 });
    expect(undoDepth()).toBe(depthBefore);
  });

  // ---- Geofence round-trip ----
  it('undo/redo round-trips a geofence change', () => {
    // Record the (empty) geofence state, then mutate it.
    useMissionStore.getState().setWaypoints(useMissionStore.getState().waypoints);
    expect(useGeofenceStore.getState().polygonPoints).toEqual([]);

    // A geofence edit pairs with a history record at the call site; emulate that.
    // (In the planner the draw handler records before the store write.)
    recordPoint(); // records current combined state (empty fence)
    useGeofenceStore.getState().setPolygonPoints([[1, 2], [3, 4], [5, 6]]);
    useGeofenceStore.getState().setEnabled(true);

    expect(useGeofenceStore.getState().polygonPoints).toHaveLength(3);

    useMissionStore.getState().undo();
    expect(useGeofenceStore.getState().polygonPoints).toEqual([]);
    expect(useGeofenceStore.getState().enabled).toBe(false);

    useMissionStore.getState().redo();
    expect(useGeofenceStore.getState().polygonPoints).toHaveLength(3);
    expect(useGeofenceStore.getState().enabled).toBe(true);
  });

  // ---- Rally round-trip ----
  it('undo/redo round-trips a rally change', () => {
    recordPoint();
    useRallyStore.getState().addPoint({ id: 'r1', lat: 1, lon: 2, alt: 30 });
    expect(useRallyStore.getState().points).toHaveLength(1);

    useMissionStore.getState().undo();
    expect(useRallyStore.getState().points).toHaveLength(0);

    useMissionStore.getState().redo();
    expect(useRallyStore.getState().points).toHaveLength(1);
    expect(useRallyStore.getState().points[0].id).toBe('r1');
  });

  // ---- Drawn-shape round-trip ----
  it('undo/redo round-trips a drawn-shape change', () => {
    recordPoint();
    useDrawingStore.getState().addPolygon(makePolygon('p1'));
    expect(useDrawingStore.getState().polygons).toHaveLength(1);

    useMissionStore.getState().undo();
    expect(useDrawingStore.getState().polygons).toHaveLength(0);

    useMissionStore.getState().redo();
    expect(useDrawingStore.getState().polygons).toHaveLength(1);
    expect(useDrawingStore.getState().polygons[0].id).toBe('p1');
  });

  // ---- Mixed sequence undone in reverse order ----
  it('a mixed sequence (waypoint, geofence, rally) undoes step-by-step in reverse', () => {
    // Step 1: add a waypoint.
    useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-1' }));
    // Step 2: set a geofence.
    recordPoint();
    useGeofenceStore.getState().setPolygonPoints([[1, 2], [3, 4], [5, 6]]);
    // Step 3: add a rally point.
    recordPoint();
    useRallyStore.getState().addPoint({ id: 'r1', lat: 1, lon: 2, alt: 30 });

    // All three present.
    expect(useMissionStore.getState().waypoints).toHaveLength(1);
    expect(useGeofenceStore.getState().polygonPoints).toHaveLength(3);
    expect(useRallyStore.getState().points).toHaveLength(1);

    // Undo step 3 (rally) — waypoint + geofence remain.
    useMissionStore.getState().undo();
    expect(useRallyStore.getState().points).toHaveLength(0);
    expect(useGeofenceStore.getState().polygonPoints).toHaveLength(3);
    expect(useMissionStore.getState().waypoints).toHaveLength(1);

    // Undo step 2 (geofence) — only waypoint remains.
    useMissionStore.getState().undo();
    expect(useGeofenceStore.getState().polygonPoints).toHaveLength(0);
    expect(useMissionStore.getState().waypoints).toHaveLength(1);

    // Undo step 1 (waypoint) — everything empty.
    useMissionStore.getState().undo();
    expect(useMissionStore.getState().waypoints).toHaveLength(0);
  });

  it('redo replays a mixed sequence forward', () => {
    useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-1' }));
    recordPoint();
    useRallyStore.getState().addPoint({ id: 'r1', lat: 1, lon: 2, alt: 30 });

    useMissionStore.getState().undo(); // undo rally
    useMissionStore.getState().undo(); // undo waypoint
    expect(useMissionStore.getState().waypoints).toHaveLength(0);
    expect(useRallyStore.getState().points).toHaveLength(0);

    useMissionStore.getState().redo(); // replay waypoint
    expect(useMissionStore.getState().waypoints).toHaveLength(1);
    expect(useRallyStore.getState().points).toHaveLength(0);

    useMissionStore.getState().redo(); // replay rally
    expect(useRallyStore.getState().points).toHaveLength(1);
  });

  // ---- Snapshots are deep-copied (no aliasing) ----
  it('a later mutation does not corrupt a stored snapshot', () => {
    recordPoint();
    useGeofenceStore.getState().setPolygonPoints([[1, 2], [3, 4], [5, 6]]);

    recordPoint(); // snapshot the 3-point fence
    // Mutate the fence further.
    useGeofenceStore.getState().setPolygonPoints([[9, 9]]);
    expect(useGeofenceStore.getState().polygonPoints).toEqual([[9, 9]]);

    // Undo should restore the 3-point fence exactly, not an aliased/mutated one.
    useMissionStore.getState().undo();
    expect(useGeofenceStore.getState().polygonPoints).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  // ---- Recording clears the redo branch ----
  it('a new edit after undo clears the redo timeline', () => {
    useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-1' }));
    useMissionStore.getState().undo();
    expect(redoDepth()).toBe(1);

    // A fresh edit branches off — redo is dropped.
    useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-2' }));
    expect(redoDepth()).toBe(0);
  });

  // ---- History clears on a new mission ----
  it('createMission clears the coordinated history', () => {
    useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-1' }));
    expect(undoDepth()).toBeGreaterThan(0);

    useMissionStore.getState().createMission('Fresh', 'drone-1');
    expect(undoDepth()).toBe(0);
    expect(redoDepth()).toBe(0);
  });

  // ---- undo on an empty timeline is a no-op ----
  it('undo / redo on an empty timeline do nothing', () => {
    expect(undoDepth()).toBe(0);
    useMissionStore.getState().undo();
    useMissionStore.getState().redo();
    expect(useMissionStore.getState().waypoints).toEqual([]);
    expect(undoDepth()).toBe(0);
    expect(redoDepth()).toBe(0);
  });

  // ---- The history-depth store backs the toolbar canUndo/canRedo affordances ----
  it('the history-depth store reflects the timeline depth', () => {
    expect(usePlannerHistoryStore.getState().canUndo).toBe(false);
    useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-1' }));
    expect(usePlannerHistoryStore.getState().canUndo).toBe(true);
    useMissionStore.getState().undo();
    expect(usePlannerHistoryStore.getState().canUndo).toBe(false);
    expect(usePlannerHistoryStore.getState().canRedo).toBe(true);
  });

  // The store republishes on every timeline event, so the planner selects the
  // two flags field by field rather than subscribing to the whole store.
  it('a field-selected subscriber re-renders only when a flag flips', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return {
        canUndo: usePlannerHistoryStore((s) => s.canUndo),
        canRedo: usePlannerHistoryStore((s) => s.canRedo),
      };
    });

    expect(result.current.canUndo).toBe(false);
    const initial = renders;

    // The first edit flips canUndo, which has to reach the toolbar.
    act(() => {
      useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-1' }));
    });
    expect(result.current.canUndo).toBe(true);
    const afterFlip = renders;
    expect(afterFlip).toBeGreaterThan(initial);

    // Later edits keep recording history points, but both flags already hold
    // their final value, so they must not cost a render.
    act(() => {
      useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-2' }));
      useMissionStore.getState().addWaypoint(makeWaypoint({ id: 'wp-3' }));
    });
    expect(result.current.canUndo).toBe(true);
    expect(renders).toBe(afterFlip);
  });
});

// A geofence / rally / drawing edit in the planner records a history point at the
// call site (the draw handler) right before writing the store, using the
// public recordHistory() verb from planner-history. The tests call it directly,
// exactly as a non-waypoint domain call site would.
function recordPoint() {
  recordHistory();
}
