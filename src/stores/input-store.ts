import { create } from "zustand";
import type { InputController } from "@/lib/types";

import { safeLocalRead } from "@/lib/storage/safe-parse";

const CAL_STORAGE_KEY = "ados-gamepad-cal";

export interface GamepadCalibration {
  center: [number, number, number, number]; // roll, pitch, throttle, yaw center values
  min: [number, number, number, number];    // axis minimums
  max: [number, number, number, number];    // axis maximums
}

/** A four-element numeric tuple, as the calibration shape requires. */
function isAxisTuple(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * Read the persisted calibration, rejecting anything that is not the exact
 * shape the poller indexes.
 *
 * `safeLocalRead` only guarantees the JSON parsed. A corrupt or hand-edited
 * `ados-gamepad-cal` entry therefore reached `calibration.center[0]` inside
 * the RAF poll body and THREW — which killed the poll loop permanently while
 * `activeController` stayed `"gamepad"`, so the manual-control gate kept
 * passing and the stream kept re-sending the last stick snapshot.
 */
const loadCalibration = (): GamepadCalibration | null => {
  const raw = safeLocalRead<unknown>(CAL_STORAGE_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<GamepadCalibration>;
  if (!isAxisTuple(c.center) || !isAxisTuple(c.min) || !isAxisTuple(c.max)) {
    return null;
  }
  return { center: c.center, min: c.min, max: c.max };
};

interface InputStoreState {
  activeController: InputController;
  axes: [number, number, number, number]; // roll, pitch, throttle, yaw
  /**
   * When `axes` was last produced by a real gamepad read, or null when nothing
   * has read one.
   *
   * The sticks are produced by a `requestAnimationFrame` loop and transmitted
   * by an independent `setTimeout` chain. Backgrounding the window pauses RAF
   * entirely while `setTimeout` keeps firing, so without a liveness stamp the
   * last snapshot was re-sent to an ARMED aircraft indefinitely — inside
   * ArduPilot's 3 s `RC_OVERRIDE_TIME`, so the vehicle never saw a dropout.
   */
  axesAt: number | null;
  rawAxes: [number, number, number, number]; // pre-calibration raw values
  buttons: boolean[];
  deadzone: number;
  expo: number;
  calibration: GamepadCalibration | null;
  /**
   * The operator opted in to flying with the gamepad. Off at every start and
   * revoked whenever the controller drops, because the stream it authorizes is
   * an RC override, not a display preference.
   */
  manualControlEnabled: boolean;
  /**
   * Why the connected link cannot carry stick frames, or null when it can.
   *
   * Distinct from the gate in `manual-control-gate`: that says the operator or
   * the aircraft is not ready, this says the link itself would discard every
   * frame. A Betaflight flight controller whose receiver is not set to MSP is
   * the case it exists for — the stream runs, the frames are refused, and
   * without this the operator sees a live stick display and no aircraft
   * response with nothing on screen to explain it.
   */
  manualControlLinkBlock: string | null;

  setController: (controller: InputController) => void;
  setAxes: (axes: [number, number, number, number]) => void;
  setRawAxes: (axes: [number, number, number, number]) => void;
  setButtons: (buttons: boolean[]) => void;
  setDeadzone: (deadzone: number) => void;
  setExpo: (expo: number) => void;
  setCalibration: (cal: GamepadCalibration) => void;
  clearCalibration: () => void;
  setManualControlEnabled: (enabled: boolean) => void;
  setManualControlLinkBlock: (reason: string | null) => void;
  resetInput: () => void;
}

export const useInputStore = create<InputStoreState>((set) => ({
  activeController: "none",
  axes: [0, 0, 0, 0],
  axesAt: null,
  rawAxes: [0, 0, 0, 0],
  buttons: new Array(16).fill(false),
  deadzone: 0.05,
  expo: 0.3,
  calibration: loadCalibration(),
  manualControlEnabled: false,
  manualControlLinkBlock: null,

  setController: (activeController) => set({ activeController }),
  setAxes: (axes) => set({ axes, axesAt: Date.now() }),
  setRawAxes: (rawAxes) => set({ rawAxes }),
  setButtons: (buttons) => set({ buttons }),
  setDeadzone: (deadzone) => set({ deadzone }),
  setExpo: (expo) => set({ expo }),
  setCalibration: (calibration) => {
    localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(calibration));
    set({ calibration });
  },
  clearCalibration: () => {
    localStorage.removeItem(CAL_STORAGE_KEY);
    set({ calibration: null });
  },
  setManualControlEnabled: (manualControlEnabled) => set({ manualControlEnabled }),
  setManualControlLinkBlock: (manualControlLinkBlock) => set({ manualControlLinkBlock }),
  resetInput: () =>
    set({
      activeController: "none",
      axes: [0, 0, 0, 0],
      axesAt: null,
      rawAxes: [0, 0, 0, 0],
      buttons: new Array(16).fill(false),
      // The reason belongs to a link that is no longer being written to.
      manualControlLinkBlock: null,
      // Losing the controller revokes the opt-in. Re-attaching one must be an
      // explicit decision to fly again, not a silent resumption.
      manualControlEnabled: false,
    }),
}));
