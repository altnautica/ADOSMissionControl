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
 * Coalesced `_version` bumper. A saturated DroneCAN bus pushes several
 * thousand frames/sec; one `set()` per frame was one React commit per frame.
 * The counters below still mutate per frame — only the notification is
 * coalesced.
 */
const bumper = createVersionBumper(() =>
  useDroneCanBusStore.setState((s) => ({ _version: s._version + 1 })),
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

    const counters = { ...state.counters };
    const payloadLen = frame.payload.byteLength;
    if (frame.dir === "in") counters.bytesIn += payloadLen;
    else counters.bytesOut += payloadLen;

    const now = Date.now();
    const elapsed = now - state._lastTallyAt;
    let framesSinceTally = state._framesSinceTally + 1;
    let errorsSinceTally = state._errorsSinceTally + (frame.error ? 1 : 0);
    let lastTally = state._lastTallyAt;

    if (elapsed >= 1000) {
      counters.fps = Math.round((framesSinceTally * 1000) / elapsed);
      counters.errorsPs = Math.round((errorsSinceTally * 1000) / elapsed);
      lastTally = now;
      framesSinceTally = 0;
      errorsSinceTally = 0;
    }

    set({
      counters,
      _lastTallyAt: lastTally,
      _framesSinceTally: framesSinceTally,
      _errorsSinceTally: errorsSinceTally,
    });
    bumper.scheduleVersionBump();
  },

  clear: () => {
    bumper.cancelVersionBump();
    get().frames.clear();
    set({
      counters: { ...ZERO_COUNTERS },
      _lastTallyAt: Date.now(),
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
    set({
      paused: false,
      _lastTallyAt: Date.now(),
      _framesSinceTally: 0,
      _errorsSinceTally: 0,
      _version: get()._version + 1,
    });
  },
}));
