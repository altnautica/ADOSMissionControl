/**
 * SLCAN mode state machine.
 *
 * Tracks the lifecycle of a single SLCAN session for the connected drone:
 *
 *   IDLE → ENTERING_SLCAN → SLCAN_ACTIVE → EXITING_SLCAN → RECONNECTING_MAVLINK → IDLE
 *
 * The flash arbiter drives the transitions; UI components subscribe via
 * selectors. `timeoutSec` is the CAN_SLCAN_TIMOUT the session wrote: an
 * idle watchdog on the FC, not a deadline, so the store keeps no countdown.
 *
 * @module stores/slcan-mode-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type SlcanModeState =
  | "IDLE"
  | "ENTERING_SLCAN"
  | "SLCAN_ACTIVE"
  | "EXITING_SLCAN"
  | "RECONNECTING_MAVLINK"
  | "ERROR";

export interface SlcanModeSnapshot {
  state: SlcanModeState;
  droneId: string | null;
  bus: 1 | 2 | null;
  bitrate: number | null;
  /** CAN_SLCAN_TIMOUT written for this session: seconds of SLCAN idle
   * after which the FC reverts the port to MAVLink. */
  timeoutSec: number | null;
  errorMessage: string | null;
  /**
   * Hand-back closure that tears down the SLCAN session and restores
   * MAVLink. Populated by the flash arbiter once SLCAN_ACTIVE is reached
   * and cleared whenever the state machine returns to IDLE. The banner
   * uses this to drive the "Resume MAVLink" button.
   */
  exitFn: (() => Promise<void>) | null;
}

export interface BeginEnteringArgs {
  droneId: string;
  bus: 1 | 2;
  bitrate: number;
  timeoutSec: number;
}

interface SlcanModeActions {
  beginEntering(args: BeginEnteringArgs): void;
  markActive(): void;
  beginExiting(): void;
  markReconnecting(): void;
  markError(message: string): void;
  reset(): void;
  /**
   * Register the closure that exits SLCAN mode. The arbiter calls this
   * right after `markActive()` so the banner can drive a "Resume MAVLink"
   * button independently of the panel that triggered entry.
   */
  setExitFn(exitFn: (() => Promise<void>) | null): void;
}

const INITIAL: SlcanModeSnapshot = {
  state: "IDLE",
  droneId: null,
  bus: null,
  bitrate: null,
  timeoutSec: null,
  errorMessage: null,
  exitFn: null,
};

export const useSlcanModeStore = create<SlcanModeSnapshot & SlcanModeActions>(
  (set, get) => ({
    ...INITIAL,

    beginEntering: ({ droneId, bus, bitrate, timeoutSec }) => {
      const s = get();
      // Single-flight — only legal from IDLE or ERROR.
      if (s.state !== "IDLE" && s.state !== "ERROR") {
        throw new Error(
          `Cannot begin SLCAN entry from state "${s.state}"; reset first`,
        );
      }
      set({
        state: "ENTERING_SLCAN",
        droneId,
        bus,
        bitrate,
        timeoutSec,
        errorMessage: null,
      });
    },

    markActive: () => {
      const s = get();
      if (s.state !== "ENTERING_SLCAN") return;
      set({ state: "SLCAN_ACTIVE" });
    },

    beginExiting: () => {
      const s = get();
      if (s.state !== "SLCAN_ACTIVE" && s.state !== "ERROR") return;
      // Clear the exit closure as soon as exit starts so the banner can
      // disable its Resume button (the closure is mid-flight and cannot
      // be re-entered safely).
      set({ state: "EXITING_SLCAN", exitFn: null });
    },

    markReconnecting: () => {
      set({ state: "RECONNECTING_MAVLINK" });
    },

    markError: (message) => {
      set({ state: "ERROR", errorMessage: message });
    },

    reset: () => {
      set({ ...INITIAL });
    },

    setExitFn: (exitFn) => {
      set({ exitFn });
    },
  }),
);
