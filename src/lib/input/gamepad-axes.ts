/**
 * Stick and button shaping for the gamepad poller: the TX-mode axis maps,
 * calibration, deadzones, expo, and the button frames the input store and the
 * MANUAL_CONTROL bitmask are built from. Pure functions, no browser state.
 *
 * @license GPL-3.0-only
 */

import type { TxMode } from "@/stores/input-store";
import { isCockpitChordButton } from "@/lib/skills/chord";

/**
 * Radial deadzone: the stick vector inside `dz` reads zero, outside it is
 * rescaled so the edge of the deadzone is 0 and full deflection stays 1.
 */
export function radialDeadzone(x: number, y: number, dz: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag <= dz) return [0, 0];
  const scaled = Math.min(1, (mag - dz) / (1 - dz)) / mag;
  return [x * scaled, y * scaled];
}

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

// Mode 1: pitch and throttle swap sticks relative to mode 2, so the left stick
// carries yaw and pitch and the right stick carries roll and throttle.
const MODE_1_MAPPING: GamepadMapping = {
  rollAxis: 2, // right stick X
  pitchAxis: 1, // left stick Y (swapped with throttle)
  throttleAxis: 3, // right stick Y (swapped with pitch)
  yawAxis: 0, // left stick X
  txMode: 1,
};

/** Apply deadzone — inputs below threshold snap to 0. */
export function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  // Scale remaining range from 0..1 after deadzone
  const sign = value > 0 ? 1 : -1;
  return (sign * (Math.abs(value) - deadzone)) / (1 - deadzone);
}

/** Normalize one raw axis to -1..1 from its measured center/min/max. */
export function applyCal(raw: number, center: number, min: number, max: number): number {
  const adjusted = raw - center;
  const halfRange = adjusted >= 0 ? (max - center) : (center - min);
  if (halfRange <= 0.01) return 0;
  return Math.max(-1, Math.min(1, adjusted / halfRange));
}

/** Apply exponential curve — higher expo = more gentle near center, more aggressive at extremes. */
export function applyExpo(value: number, expo: number): number {
  // Blend linear and cubic: output = (1-expo)*value + expo*value^3
  return (1 - expo) * value + expo * value * value * value;
}

/**
 * Buttons in the W3C standard mapping, PS (16) and touchpad (17) included.
 * Every one reaches the input store; only the MANUAL_CONTROL mask stops at 16.
 */
const STANDARD_BUTTON_COUNT = 18;

/**
 * Convert gamepad buttons to a boolean array for the input store.
 *
 * Each call returns its own array. Sharing one buffer would publish the same
 * reference on every frame, so a store subscriber comparing references would
 * never see a press, and a consumer holding a previous frame would find it
 * rewritten underneath. Eighteen booleans per frame is the same order as the
 * axes array published alongside it.
 */
export function buttonsToArray(buttons: readonly GamepadButton[]): boolean[] {
  const out: boolean[] = new Array(Math.max(buttons.length, STANDARD_BUTTON_COUNT)).fill(false);
  for (let i = 0; i < buttons.length; i++) out[i] = buttons[i]?.pressed ?? false;
  return out;
}

/** Get the mapping for a TX mode. */
export function getMappingForMode(mode: TxMode): GamepadMapping {
  return mode === 1 ? MODE_1_MAPPING : MODE_2_MAPPING;
}

/**
 * The MANUAL_CONTROL button bitmask for a button frame: the first 16 buttons,
 * minus the cockpit's chord and menu buttons (`COCKPIT_GAMEPAD_BUTTON`).
 */
export function manualControlButtonMask(buttons: readonly boolean[]): number {
  let bitmask = 0;
  for (let i = 0; i < Math.min(buttons.length, 16); i++) {
    if (buttons[i] && !isCockpitChordButton(i)) bitmask |= 1 << i;
  }
  return bitmask;
}
