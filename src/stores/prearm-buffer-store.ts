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
 * Also surfaces typed pre-arm channels (vision, future: ekf, gps, ...).
 * A channel carries a single status snapshot rather than a free-form
 * STATUSTEXT line, so the GCS can render a structured row per concern
 * instead of inferring from string matching. Channels live alongside
 * the STATUSTEXT buffer to keep the storage surface for "pre-arm"
 * unified.
 *
 * @module stores/prearm-buffer-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

const MAX_LINES_PER_DRONE = 20;

/** Possible status values for a structured pre-arm channel. */
export type PrearmChannelStatus = "ok" | "blocking" | "warning" | "unknown";

/** Snapshot of a single structured pre-arm channel. */
export interface PrearmChannelState {
  status: PrearmChannelStatus;
  reason?: string;
  /** Epoch ms when this snapshot was produced. 0 means never set. */
  updatedAt: number;
}

const INITIAL_VISION_STATE: PrearmChannelState = {
  status: "unknown",
  updatedAt: 0,
};

interface State {
  /** droneId → ring-style array of recent prearm STATUSTEXT lines. */
  buffers: Record<string, string[]>;
  /** Vision-navigation pre-arm channel. Surfaces blockers specific to
   * the vision companion (process state, EKF origin, etc.). Set by the
   * telemetry bridge once the vision-nav plugin emitter ships. */
  vision: PrearmChannelState;
}

interface Actions {
  /** Append a STATUSTEXT line for the given drone. Filters to lines starting with "PreArm:". */
  push: (droneId: string, text: string) => void;
  /** Read (and clear) the buffered lines for the drone. Returns a copy. */
  drain: (droneId: string) => string[];
  /** Read the buffered lines without clearing. */
  peek: (droneId: string) => string[];
  /**
   * Drop one drone's buffered lines (on disconnect). `drain` is the only other
   * shrink path and it only runs on arm, so a drone that connects and leaves
   * without arming would otherwise pin its lines for the whole session.
   */
  clearForDrone: (droneId: string) => void;
  /** Drop every drone's buffered lines (on a full drone-manager reset). */
  clearAll: () => void;
  /** Publish a new snapshot for the vision pre-arm channel. Idempotent
   * — passing an identical snapshot does not trigger subscribers. */
  setVisionState: (state: PrearmChannelState) => void;
}

export const usePrearmBufferStore = create<State & Actions>((set, get) => ({
  buffers: {},
  vision: INITIAL_VISION_STATE,

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

  setVisionState: (next) => {
    const current = get().vision;
    if (
      current.status === next.status &&
      current.reason === next.reason &&
      current.updatedAt === next.updatedAt
    ) {
      return;
    }
    set({ vision: next });
  },

  clearForDrone: (droneId) => {
    if (!(droneId in get().buffers)) return;
    set((s) => {
      const next = { ...s.buffers };
      delete next[droneId];
      return { buffers: next };
    });
  },

  clearAll: () => {
    if (Object.keys(get().buffers).length === 0) return;
    set({ buffers: {} });
  },
}));

/** Selector helper for the vision pre-arm channel snapshot. */
export const useVisionChannel = (s: State & Actions): PrearmChannelState =>
  s.vision;
