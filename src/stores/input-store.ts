import { create } from "zustand";
import type { InputController } from "@/lib/types";

const CAL_STORAGE_KEY = "ados-gamepad-cal";

export interface GamepadCalibration {
  center: [number, number, number, number]; // roll, pitch, throttle, yaw center values
  min: [number, number, number, number];    // axis minimums
  max: [number, number, number, number];    // axis maximums
}

function loadCalibration(): GamepadCalibration | null {
  try {
    const raw = localStorage.getItem(CAL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GamepadCalibration;
  } catch {
    return null;
  }
}

interface InputStoreState {
  activeController: InputController;
  axes: [number, number, number, number]; // roll, pitch, throttle, yaw
  rawAxes: [number, number, number, number]; // pre-calibration raw values
  buttons: boolean[];
  deadzone: number;
  expo: number;
  calibration: GamepadCalibration | null;

  setController: (controller: InputController) => void;
  setAxes: (axes: [number, number, number, number]) => void;
  setRawAxes: (axes: [number, number, number, number]) => void;
  setButtons: (buttons: boolean[]) => void;
  setDeadzone: (deadzone: number) => void;
  setExpo: (expo: number) => void;
  setCalibration: (cal: GamepadCalibration) => void;
  clearCalibration: () => void;
  resetInput: () => void;
}

export const useInputStore = create<InputStoreState>((set) => ({
  activeController: "none",
  axes: [0, 0, 0, 0],
  rawAxes: [0, 0, 0, 0],
  buttons: new Array(16).fill(false),
  deadzone: 0.05,
  expo: 0.3,
  calibration: loadCalibration(),

  setController: (activeController) => set({ activeController }),
  setAxes: (axes) => set({ axes }),
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
  resetInput: () =>
    set({
      activeController: "none",
      axes: [0, 0, 0, 0],
      rawAxes: [0, 0, 0, 0],
      buttons: new Array(16).fill(false),
    }),
}));
