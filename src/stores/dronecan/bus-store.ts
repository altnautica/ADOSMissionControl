/**
 * @module dronecan/bus-store
 * @description Zustand store for the live DroneCAN bus monitor.
 *
 * Holds a ring buffer of decoded frames (cap 4096), rolling 1Hz counters
 * (fps, errors per second, byte totals), and a pause flag. Counters are
 * computed over a sliding 1-second window of the most recently pushed
 * frames so the display matches what the user sees in the buffer.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { createVersionBumper } from "../coalesced-version";
import { RingBuffer } from "@/lib/ring-buffer";

export interface DecodedFrame {
  t: number;
  dir: "in" | "out";
  canId: number;
  decoded: {
    kind: "message" | "service" | "anonymous";
    dataTypeId: number;
    srcNodeId: number;
    dstNodeId?: number;
    isRequest?: boolean;
  };
  payload: Uint8Array;
  label?: string;
  error?: boolean;
}

export interface BusCounters {
  fps: number;
  errorsPs: number;
  bytesIn: number;
  bytesOut: number;
}

const FRAME_CAP = 4096;

interface BusStoreState {
  frames: RingBuffer<DecodedFrame>;
  counters: BusCounters;
  paused: boolean;
  _version: number;
  _lastTallyAt: number;
  _framesSinceTally: number;
  _errorsSinceTally: number;

  pushFrame: (frame: DecodedFrame) => void;
  clear: () => void;
  pause: () => void;
  resume: () => void;
}

const ZERO_COUNTERS: BusCounters = {
  fps: 0,
  errorsPs: 0,
  bytesIn: 0,
  bytesOut: 0,
};

/**
 * Frame tallies and byte counters, accumulated OUT of store state.
 *
 * `pushFrame` used to `set()` these on every frame, which notifies every
 * subscriber synchronously and defeats the coalescing bumper on the next
 * line: a saturated bus at several thousand frames/sec produced that many
 * React notification passes per second, plus one more per animation frame
 * from the bump itself. Accumulating here and publishing inside `bump`
 * holds the whole store to one notification per frame.
 */
const tally = {
  counters: { ...ZERO_COUNTERS },
  lastTallyAt: Date.now(),
  framesSinceTally: 0,
  errorsSinceTally: 0,
};

/** Zero the out-of-store tally. Must accompany every state reset below. */
function resetTally(): void {
  tally.counters = { ...ZERO_COUNTERS };
  tally.lastTallyAt = Date.now();
  tally.framesSinceTally = 0;
  tally.errorsSinceTally = 0;
}

/**
 * Coalesced `_version` bumper. A saturated DroneCAN bus pushes several
 * thousand frames/sec; one `set()` per frame was one React commit per frame.
 */
const bumper = createVersionBumper(() =>
  useDroneCanBusStore.setState((s) => ({
    _version: s._version + 1,
    counters: tally.counters,
    _lastTallyAt: tally.lastTallyAt,
    _framesSinceTally: tally.framesSinceTally,
    _errorsSinceTally: tally.errorsSinceTally,
  })),
);

/** Test/debug affordance: true while a coalesced bump is pending. */
export const droneCanBusBumpPending = bumper.hasPendingBump;

export const useDroneCanBusStore = create<BusStoreState>((set, get) => ({
  frames: new RingBuffer<DecodedFrame>(FRAME_CAP),
  counters: { ...ZERO_COUNTERS },
  paused: false,
  _version: 0,
  _lastTallyAt: Date.now(),
  _framesSinceTally: 0,
  _errorsSinceTally: 0,

  pushFrame: (frame) => {
    const state = get();
    if (state.paused) return;

    state.frames.push(frame);

    // A fresh object per publish, not per frame: consumers select
    // `counters` by reference, so the bump must hand them a new one.
    const counters = { ...tally.counters };
    const payloadLen = frame.payload.byteLength;
    if (frame.dir === "in") counters.bytesIn += payloadLen;
    else counters.bytesOut += payloadLen;

    const now = Date.now();
    const elapsed = now - tally.lastTallyAt;
    tally.framesSinceTally += 1;
    if (frame.error) tally.errorsSinceTally += 1;

    if (elapsed >= 1000) {
      counters.fps = Math.round((tally.framesSinceTally * 1000) / elapsed);
      counters.errorsPs = Math.round((tally.errorsSinceTally * 1000) / elapsed);
      tally.lastTallyAt = now;
      tally.framesSinceTally = 0;
      tally.errorsSinceTally = 0;
    }

    tally.counters = counters;
    bumper.scheduleVersionBump();
  },

  clear: () => {
    bumper.cancelVersionBump();
    get().frames.clear();
    resetTally();
    set({
      counters: tally.counters,
      _lastTallyAt: tally.lastTallyAt,
      _framesSinceTally: 0,
      _errorsSinceTally: 0,
      _version: get()._version + 1,
    });
  },

  pause: () => {
    if (get().paused) return;
    set({ paused: true, _version: get()._version + 1 });
  },

  resume: () => {
    if (!get().paused) return;
    // The rate window restarts from now, so the accumulated byte totals
    // survive but the per-second tallies do not.
    tally.lastTallyAt = Date.now();
    tally.framesSinceTally = 0;
    tally.errorsSinceTally = 0;
    set({
      paused: false,
      _lastTallyAt: tally.lastTallyAt,
      _framesSinceTally: 0,
      _errorsSinceTally: 0,
      _version: get()._version + 1,
    });
  },
}));
