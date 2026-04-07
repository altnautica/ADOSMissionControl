/**
 * @module can-monitor-store
 * @description Zustand store for the CAN traffic monitor panel.
 * Holds a ring buffer of recent CAN frames with simple statistics.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";

export interface CanFrameRecord {
  timestamp: number;
  bus: number;
  id: number;
  len: number;
  data: Uint8Array;
}

const MAX_FRAMES = 500;

interface CanMonitorState {
  frames: RingBuffer<CanFrameRecord>;
  enabled: boolean;
  /** Per-CAN-ID frame counter for the last minute. */
  idCounts: Map<number, number>;
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

export const useCanMonitorStore = create<CanMonitorState>((set, get) => ({
  frames: new RingBuffer<CanFrameRecord>(MAX_FRAMES),
  enabled: false,
  idCounts: new Map(),
  totalFrames: 0,
  framesPerSecond: 0,
  _lastTallyAt: Date.now(),
  _countSinceTally: 0,
  _version: 0,

  pushFrame: (frame) => {
    const state = get();
    if (!state.enabled) return;
    state.frames.push(frame);
    state.idCounts.set(frame.id, (state.idCounts.get(frame.id) ?? 0) + 1);

    const now = Date.now();
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
      _version: state._version + 1,
    });
  },

  setEnabled: (enabled) => {
    if (enabled === get().enabled) return;
    if (!enabled) {
      // Reset stats when disabling
      get().frames.clear();
      set({
        enabled: false,
        idCounts: new Map(),
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
    get().frames.clear();
    set({
      idCounts: new Map(),
      totalFrames: 0,
      framesPerSecond: 0,
      _countSinceTally: 0,
      _lastTallyAt: Date.now(),
      _version: get()._version + 1,
    });
  },
}));
