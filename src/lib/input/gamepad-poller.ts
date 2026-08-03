/**
 * Gamepad polling for Altnautica Command GCS.
 *
 * Two independent lifecycles, deliberately kept apart:
 *
 * - `startGamepadPolling` reads `navigator.getGamepads()` at display rate,
 *   applies calibration, deadzone, and expo, and publishes axes and buttons to
 *   the input store. It transmits nothing. Any surface that needs to see a
 *   button press — binding capture, a calibration wizard — wants this one.
 * - `startManualControlStream` transmits those sticks to the aircraft as an RC
 *   override, at the rate the connected link declares, and only while every
 *   condition in {@link manualControlAllowed} holds. Only a flying surface
 *   starts this.
 *
 * They were one function, which meant opening a keybinding panel opened an RC
 * override on the connected aircraft.
 */

import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { manualControlAllowed } from "./manual-control-gate";

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
function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  // Scale remaining range from 0..1 after deadzone
  const sign = value > 0 ? 1 : -1;
  return (sign * (Math.abs(value) - deadzone)) / (1 - deadzone);
}

/** Apply calibration offset — normalize raw axis to -1..1 based on measured center/min/max. */
function applyCal(raw: number, center: number, min: number, max: number): number {
  const adjusted = raw - center;
  const halfRange = adjusted >= 0 ? (max - center) : (center - min);
  if (halfRange <= 0.01) return 0;
  return Math.max(-1, Math.min(1, adjusted / halfRange));
}

/** Apply exponential curve — higher expo = more gentle near center, more aggressive at extremes. */
function applyExpo(value: number, expo: number): number {
  // Blend linear and cubic: output = (1-expo)*value + expo*value^3
  return (1 - expo) * value + expo * value * value * value;
}

/**
 * Convert gamepad buttons to a boolean array for the input store.
 *
 * Each call returns its own array. Sharing one buffer would publish the same
 * reference on every frame, so a store subscriber comparing references would
 * never see a press, and a consumer holding a previous frame would find it
 * rewritten underneath. Sixteen booleans per frame is the same order as the
 * axes array published alongside it.
 */
function buttonsToArray(buttons: readonly GamepadButton[]): boolean[] {
  const out: boolean[] = new Array(16).fill(false);
  const len = Math.min(buttons.length, 16);
  for (let i = 0; i < len; i++) out[i] = buttons[i]?.pressed ?? false;
  return out;
}

/**
 * How often the stream re-checks itself while it is not transmitting.
 *
 * Not a transmit rate — nothing goes on the wire on these ticks. It is only
 * how quickly the stream notices that the aircraft armed, the mode changed, or
 * a link that declares a rate was selected.
 */
const GATE_RECHECK_MS = 20;

/** Rate below which a declared cadence is treated as absent. */
const MIN_HZ = 1;

let pollAnimFrame: number | null = null;
let manualControlTimer: ReturnType<typeof setTimeout> | null = null;
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

/**
 * Start reading the gamepad into the input store. Transmits nothing — call
 * {@link startManualControlStream} as well to fly with it.
 */
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

    const { deadzone, expo, calibration } = inputStore;

    // Read raw axes and apply mapping
    let rawRoll = gp.axes[currentMapping.rollAxis] ?? 0;
    let rawPitch = -(gp.axes[currentMapping.pitchAxis] ?? 0); // Invert Y
    let rawThrottle = -(gp.axes[currentMapping.throttleAxis] ?? 0); // Invert Y: up = positive
    let rawYaw = gp.axes[currentMapping.yawAxis] ?? 0;

    // Store raw axes for calibration wizard display
    inputStore.setRawAxes([rawRoll, rawPitch, rawThrottle, rawYaw]);

    // Apply calibration offsets if available
    if (calibration) {
      rawRoll = applyCal(rawRoll, calibration.center[0], calibration.min[0], calibration.max[0]);
      rawPitch = applyCal(rawPitch, calibration.center[1], calibration.min[1], calibration.max[1]);
      rawThrottle = applyCal(rawThrottle, calibration.center[2], calibration.min[2], calibration.max[2]);
      rawYaw = applyCal(rawYaw, calibration.center[3], calibration.min[3], calibration.max[3]);
    }

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
}

/**
 * The gap between stick frames for a declared rate, or null when the rate says
 * nothing will be transmitted.
 *
 * A link reports 0 Hz when it puts nothing on the wire — an unknown autopilot
 * that declares no stick support, or an MSP flight controller that would
 * discard the frames. Sending anyway would make that report false.
 */
export function manualControlPeriodMs(hz: number): number | null {
  if (!Number.isFinite(hz) || hz < MIN_HZ) return null;
  return 1000 / hz;
}

/**
 * One pass of the manual-control stream. Returns how long to wait before the
 * next pass. Exported for tests; the stream schedules it.
 */
export function manualControlTick(): number {
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const { axes, buttons, activeController, manualControlEnabled } = useInputStore.getState();
  const { armState, flightMode } = useDroneStore.getState();

  const allowed = manualControlAllowed({
    enabled: manualControlEnabled,
    controller: activeController,
    connected: protocol?.isConnected === true,
    armState,
    flightMode,
  });
  if (!allowed || !protocol) return GATE_RECHECK_MS;

  const period = manualControlPeriodMs(protocol.getCapabilities().manualControlHz);
  if (period === null) return GATE_RECHECK_MS;

  const [roll, pitch, throttleAxis, yaw] = axes;

  // Convert boolean[] to bitmask
  let bitmask = 0;
  for (let i = 0; i < Math.min(buttons.length, 16); i++) {
    if (buttons[i]) bitmask |= 1 << i;
  }

  // The throttle axis is bipolar (-1 stick down, +1 stick up) while the
  // protocol takes throttle as 0..1 with 0 at idle, so it is remapped here
  // rather than sharing the stick scale.
  protocol.sendManualControl(roll, pitch, (throttleAxis + 1) / 2, yaw, bitmask);
  return period;
}

/**
 * Start transmitting the sticks to the selected drone as an RC override, at
 * the cadence that drone's link declares.
 *
 * Every pass re-checks the gate, so the stream stops the moment the aircraft
 * disarms, the mode changes to one the autopilot is flying, the controller
 * drops, or the operator revokes the opt-in. Nothing is sent until all of
 * those hold.
 *
 * The cadence is re-read every pass rather than fixed at start, because the
 * selected drone can change under a running stream and a Betaflight link's
 * rate is not an ArduPilot link's.
 */
export function startManualControlStream(): void {
  if (manualControlTimer) return;

  const run = () => {
    const wait = manualControlTick();
    // A tick that stopped the stream must not schedule another pass.
    if (manualControlTimer === null) return;
    manualControlTimer = setTimeout(run, wait);
  };

  manualControlTimer = setTimeout(run, 0);
}

/** Stop transmitting sticks. Leaves gamepad reading running. */
export function stopManualControlStream(): void {
  if (manualControlTimer === null) return;
  clearTimeout(manualControlTimer);
  manualControlTimer = null;
}

/**
 * Stop reading the gamepad. Also stops the manual-control stream: once the
 * axes stop updating the last frame is stale, and a stale stick frame is not
 * something to keep transmitting.
 */
export function stopGamepadPolling(): void {
  if (pollAnimFrame !== null) {
    cancelAnimationFrame(pollAnimFrame);
    pollAnimFrame = null;
  }
  stopManualControlStream();
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
