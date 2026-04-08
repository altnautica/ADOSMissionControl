/**
 * Per-drone rolling buffer of recent ArduPilot `STATUSTEXT` lines that
 * begin with `"PreArm:"`. Filled by the telemetry bridge from the
 * `protocol.onStatusText` callback. Drained by the flight lifecycle when
 * the user arms — the most recent failures get frozen into the
 * `FlightRecord.preflight.prearmFailures` snapshot.
 *
 * Bounded — capped at the last 20 lines per drone to keep memory tiny
 * even if the FC spams prearm warnings.
 *
 * @module stores/prearm-buffer-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

const MAX_LINES_PER_DRONE = 20;

interface State {
  /** droneId → ring-style array of recent prearm STATUSTEXT lines. */
  buffers: Record<string, string[]>;
}

interface Actions {
  /** Append a STATUSTEXT line for the given drone. Filters to lines starting with "PreArm:". */
  push: (droneId: string, text: string) => void;
  /** Read (and clear) the buffered lines for the drone. Returns a copy. */
  drain: (droneId: string) => string[];
  /** Read the buffered lines without clearing. */
  peek: (droneId: string) => string[];
}

export const usePrearmBufferStore = create<State & Actions>((set, get) => ({
  buffers: {},

  push: (droneId, text) => {
    if (!text || !text.startsWith("PreArm:")) return;
    set((s) => {
      const existing = s.buffers[droneId] ?? [];
      const next = [...existing, text].slice(-MAX_LINES_PER_DRONE);
      return { buffers: { ...s.buffers, [droneId]: next } };
    });
  },

  drain: (droneId) => {
    const lines = get().buffers[droneId] ?? [];
    set((s) => {
      const next = { ...s.buffers };
      delete next[droneId];
      return { buffers: next };
    });
    return lines;
  },

  peek: (droneId) => get().buffers[droneId] ?? [],
}));
