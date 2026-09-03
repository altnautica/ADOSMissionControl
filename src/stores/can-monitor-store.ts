/**
 * @module can-monitor-store
 * @description Zustand store for the CAN traffic monitor panel.
 * Holds a ring buffer of recent CAN frames with simple statistics.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { createVersionBumper } from "./coalesced-version";
import { RingBuffer } from "@/lib/ring-buffer";

export interface CanFrameRecord {
  timestamp: number;
  bus: number;
  id: number;
  len: number;
  data: Uint8Array;
}

const MAX_FRAMES = 500;

/**
 * Width of the `idCounts` window, in ms. The field is documented as a
 * per-minute tally and the panel's operator semantics is a rate, not a session
 * total, so the window is real: counts are bucketed per second and buckets
 * older than this are dropped.
 */
const ID_WINDOW_MS = 60_000;

/**
 * Ceiling on distinct CAN ids tracked at once. Extended ids are 29-bit, so a
 * noisy or fuzzing bus can present hundreds of thousands of them; without a
 * ceiling the map grows for the length of the session. When full, the id with
 * the fewest observations in the window is evicted — a flood of one-shot ids
 * cannot displace the ids actually carrying traffic.
 */
const MAX_TRACKED_IDS = 2048;

/** One second's observations for one CAN id. */
interface IdBucket {
  /** Epoch second (`Math.floor(ms / 1000)`) this bucket counts. */
  sec: number;
  count: number;
}

interface CanMonitorState {
  frames: RingBuffer<CanFrameRecord>;
  enabled: boolean;
  /**
   * Per-CAN-ID frame counter over the last {@link ID_WINDOW_MS}. Derived from
   * {@link CanMonitorState._idBuckets} on every push, so the displayed figure
   * is a rolling window rather than a lifetime total.
   */
  idCounts: Map<number, number>;
  /** Per-id second buckets backing the rolling window. Internal. */
  _idBuckets: Map<number, IdBucket[]>;
  /** Total frame count since enable. */
  totalFrames: number;
  /** Frames received in the last second. */
  framesPerSecond: number;
  /** Internal: timestamp of last per-second tally. */
  _lastTallyAt: number;
  /** Internal: count since last tally. */
  _countSinceTally: number;
  _version: number;

  pushFrame: (frame: CanFrameRecord) => void;
  setEnabled: (enabled: boolean) => void;
  clear: () => void;
}

/**
 * Fold one observation into `buckets`, dropping buckets outside the window.
 * Returns the id's total count inside the window. Mutates `buckets` in place —
 * this runs per frame, so it must not allocate in the steady state.
 */
function tallyId(buckets: IdBucket[], nowMs: number): number {
  const sec = Math.floor(nowMs / 1000);
  const oldestSec = sec - ID_WINDOW_MS / 1000;
  let drop = 0;
  while (drop < buckets.length && buckets[drop].sec < oldestSec) drop++;
  if (drop > 0) buckets.splice(0, drop);
  const tail = buckets[buckets.length - 1];
  if (tail !== undefined && tail.sec === sec) tail.count++;
  else buckets.push({ sec, count: 1 });
  let total = 0;
  for (const b of buckets) total += b.count;
  return total;
}

/**
 * Evict the lowest-count tracked id so a new one can be admitted. Called only
 * when the ceiling is reached, which a healthy bus never hits.
 */
function evictQuietestId(
  buckets: Map<number, IdBucket[]>,
  counts: Map<number, number>,
): void {
  let victim: number | null = null;
  let lowest = Infinity;
  for (const [id, count] of counts) {
    if (count < lowest) {
      lowest = count;
      victim = id;
    }
  }
  if (victim !== null) {
    counts.delete(victim);
    buckets.delete(victim);
  }
}

/**
 * Coalesced `_version` bumper. A DroneCAN bus at 1000 fps produced 1000
 * notifications/sec, and `BusMonitorSection` re-runs
 * `frames.last(80).slice().reverse()` on each one. Capped at one per frame.
 */
const bumper = createVersionBumper(() =>
  useCanMonitorStore.setState((s) => ({ _version: s._version + 1 })),
);

/** Test/debug affordance: true while a coalesced bump is pending. */
export const canMonitorBumpPending = bumper.hasPendingBump;

export const useCanMonitorStore = create<CanMonitorState>((set, get) => ({
  frames: new RingBuffer<CanFrameRecord>(MAX_FRAMES),
  enabled: false,
  idCounts: new Map(),
  _idBuckets: new Map(),
  totalFrames: 0,
  framesPerSecond: 0,
  _lastTallyAt: Date.now(),
  _countSinceTally: 0,
  _version: 0,

  pushFrame: (frame) => {
    const state = get();
    if (!state.enabled) return;
    state.frames.push(frame);

    const now = Date.now();
    const buckets = state._idBuckets;
    let idBuckets = buckets.get(frame.id);
    if (idBuckets === undefined) {
      if (buckets.size >= MAX_TRACKED_IDS) {
        evictQuietestId(buckets, state.idCounts);
      }
      idBuckets = [];
      buckets.set(frame.id, idBuckets);
    }
    state.idCounts.set(frame.id, tallyId(idBuckets, now));

    const elapsed = now - state._lastTallyAt;
    let fps = state.framesPerSecond;
    let lastTally = state._lastTallyAt;
    let count = state._countSinceTally + 1;
    if (elapsed >= 1000) {
      fps = Math.round((count * 1000) / elapsed);
      lastTally = now;
      count = 0;
    }
    set({
      totalFrames: state.totalFrames + 1,
      framesPerSecond: fps,
      _lastTallyAt: lastTally,
      _countSinceTally: count,
    });
    bumper.scheduleVersionBump();
  },

  setEnabled: (enabled) => {
    if (enabled === get().enabled) return;
    if (!enabled) {
      // Reset stats when disabling
      bumper.cancelVersionBump();
      get().frames.clear();
      set({
        enabled: false,
        idCounts: new Map(),
        _idBuckets: new Map(),
        totalFrames: 0,
        framesPerSecond: 0,
        _countSinceTally: 0,
        _lastTallyAt: Date.now(),
        _version: get()._version + 1,
      });
    } else {
      set({
        enabled: true,
        _lastTallyAt: Date.now(),
        _countSinceTally: 0,
        _version: get()._version + 1,
      });
    }
  },

  clear: () => {
    bumper.cancelVersionBump();
    get().frames.clear();
    set({
      idCounts: new Map(),
      _idBuckets: new Map(),
      totalFrames: 0,
      framesPerSecond: 0,
      _countSinceTally: 0,
      _lastTallyAt: Date.now(),
      _version: get()._version + 1,
    });
  },
}));
