/**
 * Gamepad polling system for Altnautica Command GCS.
 *
 * Polls navigator.getGamepads() at 60Hz, applies deadzone + expo curves,
 * and feeds axes/buttons to the input store. Sends MANUAL_CONTROL to the
 * connected drone at 50Hz via a separate interval.
 */

import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";

// TX mode: which physical stick controls which axis
export type TxMode = 1 | 2; // Mode 1: throttle right. Mode 2: throttle left (default)

export interface GamepadMapping {
  rollAxis: number;
  pitchAxis: number;
  throttleAxis: number;
  yawAxis: number;
  txMode: TxMode;
}

// Default: Mode 2 (left stick = throttle+yaw, right stick = roll+pitch)
const MODE_2_MAPPING: GamepadMapping = {
  rollAxis: 2, // right stick X
  pitchAxis: 3, // right stick Y
  throttleAxis: 1, // left stick Y
  yawAxis: 0, // left stick X
  txMode: 2,
};

const MODE_1_MAPPING: GamepadMapping = {
  rollAxis: 2, // right stick X
  pitchAxis: 1, // right stick Y (swapped with throttle)
  throttleAxis: 3, // left stick Y (swapped with pitch)
  yawAxis: 0, // left stick X
  txMode: 1,
};

/** Apply deadzone — inputs below threshold snap to 0. */
function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  // Scale remaining range from 0..1 after deadzone
  const sign = value > 0 ? 1 : -1;
  return (sign * (Math.abs(value) - deadzone)) / (1 - deadzone);
}

/** Apply exponential curve — higher expo = more gentle near center, more aggressive at extremes. */
function applyExpo(value: number, expo: number): number {
  // Blend linear and cubic: output = (1-expo)*value + expo*value^3
  return (1 - expo) * value + expo * value * value * value;
}

/** Convert gamepad buttons to boolean array for the input store. Reuses array to reduce GC. */
const _buttonsBuf: boolean[] = new Array(16).fill(false);
function buttonsToArray(buttons: readonly GamepadButton[]): boolean[] {
  const len = Math.min(buttons.length, 16);
  for (let i = 0; i < len; i++) _buttonsBuf[i] = buttons[i]?.pressed ?? false;
  for (let i = len; i < 16; i++) _buttonsBuf[i] = false;
  return _buttonsBuf;
}

let pollAnimFrame: number | null = null;
let manualControlInterval: ReturnType<typeof setInterval> | null = null;
let activeGamepadIndex: number | null = null;
let currentMapping: GamepadMapping = MODE_2_MAPPING;

/** Get the mapping for a TX mode. */
export function getMappingForMode(mode: TxMode): GamepadMapping {
  return mode === 1 ? MODE_1_MAPPING : MODE_2_MAPPING;
}

/** Set the active TX mode. */
export function setTxMode(mode: TxMode): void {
  currentMapping = getMappingForMode(mode);
}

/** Start gamepad polling. Call once on app init or when gamepad connects. */
export function startGamepadPolling(): void {
  if (pollAnimFrame !== null) return; // Already running

  function poll() {
    const gamepads = navigator.getGamepads();
    let gp: Gamepad | null = null;

    // Find active gamepad
    if (activeGamepadIndex !== null && gamepads[activeGamepadIndex]) {
      gp = gamepads[activeGamepadIndex];
    } else {
      // Scan for any connected gamepad
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          gp = gamepads[i];
          activeGamepadIndex = i;
          break;
        }
      }
    }

    const inputStore = useInputStore.getState();

    if (!gp) {
      if (inputStore.activeController === "gamepad") {
        inputStore.setController("none");
        inputStore.setAxes([0, 0, 0, 0]);
        inputStore.setButtons(new Array(16).fill(false));
      }
      activeGamepadIndex = null;
      pollAnimFrame = requestAnimationFrame(poll);
      return;
    }

    // Set controller type
    if (inputStore.activeController !== "gamepad") {
      inputStore.setController("gamepad");
    }

    const { deadzone, expo } = inputStore;

    // Read raw axes and apply mapping
    const rawRoll = gp.axes[currentMapping.rollAxis] ?? 0;
    const rawPitch = -(gp.axes[currentMapping.pitchAxis] ?? 0); // Invert Y
    const rawThrottle = -(gp.axes[currentMapping.throttleAxis] ?? 0); // Invert Y: up = positive
    const rawYaw = gp.axes[currentMapping.yawAxis] ?? 0;

    // Apply deadzone + expo
    const roll = applyExpo(applyDeadzone(rawRoll, deadzone), expo);
    const pitch = applyExpo(applyDeadzone(rawPitch, deadzone), expo);
    const throttle = applyExpo(applyDeadzone(rawThrottle, deadzone), expo);
    const yaw = applyExpo(applyDeadzone(rawYaw, deadzone), expo);

    inputStore.setAxes([roll, pitch, throttle, yaw]);
    inputStore.setButtons(buttonsToArray(gp.buttons));

    pollAnimFrame = requestAnimationFrame(poll);
  }

  pollAnimFrame = requestAnimationFrame(poll);

  // Start MANUAL_CONTROL at 50Hz (20ms interval)
  if (!manualControlInterval) {
    manualControlInterval = setInterval(() => {
      const protocol = useDroneManager.getState().getSelectedProtocol();
      if (!protocol?.isConnected) return;

      const { axes, buttons } = useInputStore.getState();
      const [roll, pitch, throttle, yaw] = axes;

      // Convert boolean[] to bitmask
      let bitmask = 0;
      for (let i = 0; i < Math.min(buttons.length, 16); i++) {
        if (buttons[i]) bitmask |= 1 << i;
      }

      protocol.sendManualControl(roll, pitch, throttle, yaw, bitmask);
    }, 20);
  }
}

/** Stop gamepad polling and MANUAL_CONTROL sending. */
export function stopGamepadPolling(): void {
  if (pollAnimFrame !== null) {
    cancelAnimationFrame(pollAnimFrame);
    pollAnimFrame = null;
  }
  if (manualControlInterval !== null) {
    clearInterval(manualControlInterval);
    manualControlInterval = null;
  }
  activeGamepadIndex = null;

  const inputStore = useInputStore.getState();
  if (inputStore.activeController === "gamepad") {
    inputStore.resetInput();
  }
}

/** Check if the Gamepad API is available. */
export function isGamepadSupported(): boolean {
  return typeof navigator !== "undefined" && "getGamepads" in navigator;
}

/** Get the name of the currently connected gamepad, or null. */
export function getActiveGamepadName(): string | null {
  if (activeGamepadIndex === null) return null;
  const gp = navigator.getGamepads()[activeGamepadIndex];
  return gp?.id ?? null;
}

/** Check if polling is active. */
export function isPolling(): boolean {
  return pollAnimFrame !== null;
}
