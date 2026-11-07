/**
 * Gamepad polling for Altnautica Command GCS.
 *
 * Two independent lifecycles, deliberately kept apart:
 *
 * - `acquireGamepadPolling` reads `navigator.getGamepads()` at display rate,
 *   applies calibration, deadzone, and expo, and publishes axes and buttons to
 *   the input store. It transmits nothing. Any surface that needs to see a
 *   button press — binding capture, a calibration wizard — wants this one.
 *   It is reference counted: the loop runs while any surface holds it.
 * - `startManualControlStream` transmits those sticks to the aircraft, at the
 *   rate the route declares. With an agent-connected drone in `ados` control
 *   mode the sticks go to the drone's pilot (`pilot.v1` input frames at
 *   50 Hz, radial deadzone only: the pilot applies the expo). Otherwise, for
 *   `fc_manual` or a direct-serial flight controller, they go out as an RC
 *   override, only while every condition in {@link manualControlAllowed}
 *   holds. Only a flying surface starts this.
 *
 * A pad must report the standard layout. A pad that does not is used only
 * through a calibration made in the calibration wizard; until then it is
 * read but never streamed, and {@link usePadStatusStore} says why.
 * They were one function, which meant opening a keybinding panel opened an RC
 * override on the connected aircraft.
 */

import { useInputStore, type TxMode } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { selectedDroneMqttAuthority } from "@/hooks/use-mqtt-control-authority";
import { canPublishFcFrames } from "@/lib/nodes/mqtt-control-authority";
import { manualControlAllowed } from "./manual-control-gate";
import { isReservedGamepadButton } from "@/lib/skills/chord";
import { create } from "zustand";
import {
  PAD_STALE_MS,
  PILOT_INPUT_PERIOD_MS,
  sendPilotInput,
  sendPilotRelease,
  sticksRouteToFc,
  sticksRouteToPilot,
} from "./pilot-stream";

/** Radial stick deadzone every surface applies before the pilot stream. */
export const PILOT_RADIAL_DEADZONE = 0.08;

/** What the cockpit shows about the pad itself. */
export interface PadStatus {
  /** A pad is connected (from `gamepadconnected`/`gamepaddisconnected` or a read). */
  connected: boolean;
  /** The pad has reported at least once: browsers expose a pad only after its first input. */
  seen: boolean;
  name: string | null;
  /** `mapping === "standard"`, or a calibration wizard axis map exists for this pad. */
  usable: boolean;
  /** True when the pad layout is not standard and has no calibration. */
  needsCalibration: boolean;
}

export const usePadStatusStore = create<PadStatus & { set: (p: Partial<PadStatus>) => void }>(
  (set) => ({
    connected: false,
    seen: false,
    name: null,
    usable: false,
    needsCalibration: false,
    set: (p) => set(p),
  }),
);

function patchPadStatus(p: Partial<PadStatus>): void {
  const s = usePadStatusStore.getState();
  for (const k of Object.keys(p) as (keyof PadStatus)[]) {
    if (s[k] !== p[k]) {
      s.set(p);
      return;
    }
  }
}

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

/** The last pilot-route axes [roll, pitch, thr, yaw], radial deadzone applied. */
let lastPilotAxes: [number, number, number, number] = [0, 0, 0, 0];
/** Whether the last read came from a usable pad. */
let lastPadUsable = false;

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

/** Normalize one raw axis to -1..1 from its measured center/min/max. */
export function applyCal(raw: number, center: number, min: number, max: number): number {
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

/**
 * Age at which the last gamepad sample stops counting as live.
 *
 * ~3 display frames at 60 Hz, well under ArduPilot's 3.0 s
 * `RC_OVERRIDE_TIME`, so the aircraft sees a real override dropout rather
 * than a frozen stick position the moment the reader stops.
 */
const STALE_AXES_MS = 50;


/** Why the stream sends nothing on a relay link that cannot publish. */
const RELAY_WRITE_BLOCK = "the cloud relay holds no broker write grant for this drone";

let pollAnimFrame: number | null = null;
let manualControlTimer: ReturnType<typeof setTimeout> | null = null;
let activeGamepadIndex: number | null = null;

/** Get the mapping for a TX mode. */
export function getMappingForMode(mode: TxMode): GamepadMapping {
  return mode === 1 ? MODE_1_MAPPING : MODE_2_MAPPING;
}

/** Surfaces currently holding the polling loop. */
let pollHolders = 0;

/**
 * Hold the gamepad reading loop. The loop starts with the first holder and
 * stops when the last releases, so a settings panel closing never stops the
 * cockpit's reader. Transmits nothing — call {@link startManualControlStream}
 * as well to fly with it. Returns an idempotent release.
 */
export function acquireGamepadPolling(): () => void {
  pollHolders += 1;
  installPadListeners();
  startPolling();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pollHolders -= 1;
    if (pollHolders === 0) stopPolling();
  };
}

function startPolling(): void {
  if (pollAnimFrame !== null) return; // Already running

  /**
   * One gamepad read. Wrapped by `pollSafely` below, which ALWAYS reschedules.
   *
   * A throw in here used to kill the loop permanently — and because
   * `activeController` stayed `"gamepad"`, the manual-control gate kept
   * passing and the transmit chain kept re-sending the last stick snapshot to
   * an armed aircraft. The known trigger was a corrupt persisted calibration
   * (`calibration.center[0]` on a non-array), which `input-store` now rejects
   * at read time; this is the belt-and-braces half.
   */
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
      // Losing the pad revokes the stick-control opt-in. A pad that comes
      // back must not silently resume an RC override on an armed aircraft.
      if (inputStore.activeController === "gamepad") inputStore.resetInput();
      activeGamepadIndex = null;
      lastPadUsable = false;
      lastPilotAxes = [0, 0, 0, 0];
      patchPadStatus({ connected: false, usable: false, needsCalibration: false, name: null });
      return;
    }

    // Set controller type
    if (inputStore.activeController !== "gamepad") {
      inputStore.setController("gamepad");
    }

    const { deadzone, expo, calibrations, txMode } = inputStore;
    const mapping = getMappingForMode(txMode);

    // Calibration belongs to this pad's physical axes, so it is applied before
    // the TX-mode mapping picks which axis is which stick function.
    const padAxes = Array.from(gp.axes);
    const cal = calibrations[gp.id];
    // A non-standard layout's axis order is unknown (a calibration records
    // centre and travel, not which axis is which stick), so such a pad is
    // shown but never streamed.
    const standard = gp.mapping === "standard";
    lastPadUsable = standard;
    patchPadStatus({
      connected: true,
      seen: true,
      name: gp.id,
      usable: lastPadUsable,
      needsCalibration: !lastPadUsable,
    });
    const physical = (i: number): number => {
      const v = padAxes[i] ?? 0;
      return cal && i < cal.center.length
        ? applyCal(v, cal.center[i], cal.min[i], cal.max[i])
        : v;
    };

    // Uncalibrated mapped values, for the raw readouts.
    const rawAxes: [number, number, number, number] = [
      padAxes[mapping.rollAxis] ?? 0,
      -(padAxes[mapping.pitchAxis] ?? 0), // Invert Y
      -(padAxes[mapping.throttleAxis] ?? 0), // Invert Y: up = positive
      padAxes[mapping.yawAxis] ?? 0,
    ];
    const rawRoll = physical(mapping.rollAxis);
    const rawPitch = -physical(mapping.pitchAxis);
    const rawThrottle = -physical(mapping.throttleAxis);
    const rawYaw = physical(mapping.yawAxis);

    // Pilot route: radial deadzone per physical stick, no expo (the pilot
    // shapes). Mode 2: left = throttle + yaw, right = pitch + roll. Mode 1
    // swaps the Y axes: left = pitch + yaw, right = throttle + roll.
    if (txMode === 1) {
      const [pYaw, pPitch] = radialDeadzone(rawYaw, rawPitch, deadzone);
      const [pRoll, pThr] = radialDeadzone(rawRoll, rawThrottle, deadzone);
      lastPilotAxes = [pRoll, pPitch, pThr, pYaw];
    } else {
      const [pYaw, pThr] = radialDeadzone(rawYaw, rawThrottle, deadzone);
      const [pRoll, pPitch] = radialDeadzone(rawRoll, rawPitch, deadzone);
      lastPilotAxes = [pRoll, pPitch, pThr, pYaw];
    }

    // Apply deadzone + expo
    const axes: [number, number, number, number] = [
      applyExpo(applyDeadzone(rawRoll, deadzone), expo),
      applyExpo(applyDeadzone(rawPitch, deadzone), expo),
      applyExpo(applyDeadzone(rawThrottle, deadzone), expo),
      applyExpo(applyDeadzone(rawYaw, deadzone), expo),
    ];

    // One store update per frame: three separate writes re-rendered every
    // subscriber three times at display rate.
    inputStore.publishGamepadFrame({
      gamepadId: gp.id,
      padAxes,
      axes,
      rawAxes,
      // The physical right stick, independent of the TX-mode mapping, for
      // on-screen aiming. Y is inverted so up is positive.
      rightStick: [gp.axes[2] ?? 0, -(gp.axes[3] ?? 0)],
      buttons: buttonsToArray(gp.buttons),
      // A present, connected pad is live. Its timestamp is not used: Chrome on
      // Linux advances it only when a value changes, so a stick held still
      // (centred or pinned) would read as a lost pad.
      live: gp.connected !== false,
    });
  }

  function pollSafely() {
    try {
      poll();
    } catch (err) {
      // Never let a read failure stop the loop: a dead reader with a live
      // transmit chain is a frozen stick position on an armed aircraft.
      console.error("[gamepad] poll failed", err);
    }
    pollAnimFrame = requestAnimationFrame(pollSafely);
  }

  pollAnimFrame = requestAnimationFrame(pollSafely);
}

/**
 * Stop transmitting while the document is hidden.
 *
 * `requestAnimationFrame` stops in a hidden tab but `setTimeout` does not, so
 * without this the transmit chain outlives the reader. The sample-age gate in
 * {@link manualControlTick} already refuses the stale frame; this stops the
 * chain outright so nothing is even attempted.
 */
function onVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.hidden) {
    // Pause only the timer: the operator's request to stream still stands.
    // The pilot route says so: a hidden tab releases the sticks.
    sendPilotRelease();
    if (manualControlTimer !== null) {
      clearTimeout(manualControlTimer);
      manualControlTimer = null;
    }
  } else if (manualControlRequested) {
    scheduleManualControl();
  }
}

/** Whether a caller asked for the stream and has not stopped it. */
let manualControlRequested = false;

function scheduleManualControl(): void {
  if (manualControlTimer) return;
  const run = () => {
    const wait = manualControlTick();
    // A tick that stopped the stream must not schedule another pass.
    if (manualControlTimer === null) return;
    manualControlTimer = setTimeout(run, wait);
  };
  manualControlTimer = setTimeout(run, 0);
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
 * The pilot-route pass: stream the sticks to the drone's pilot at 50 Hz, or
 * release them when the pad is gone, unusable or stale (the shared stop rules).
 * Returns the wait before the next pass.
 */
function pilotTick(now: number): number {
  const input = useInputStore.getState();
  // Liveness is the poll's own sample time while the pad is present: Chrome
  // on Linux advances `Gamepad.timestamp` only when a value changes, so a
  // stick held still (centred or pinned) has a frozen timestamp and is not
  // a lost pad. A hidden tab stops the poll, which ages the sample.
  const sampleStale = input.axesAt === null || now - input.axesAt > PAD_STALE_MS;
  if (input.activeController !== "gamepad" || !lastPadUsable || sampleStale) {
    sendPilotRelease();
    return GATE_RECHECK_MS;
  }
  // While an on-screen control has the sticks the deflection is aiming:
  // roll, pitch and throttle go out centred, which the pilot holds.
  const [roll, pitch, thr, yaw] = lastPilotAxes;
  const axes: [number, number, number, number] = input.sticksCaptured
    ? [0, 0, 0, yaw]
    : [roll, pitch, thr, yaw];
  sendPilotInput(axes, manualControlButtonMask(input.buttons));
  return PILOT_INPUT_PERIOD_MS;
}

/**
 * One pass of the manual-control stream. Returns how long to wait before the
 * next pass. Exported for tests; the stream schedules it.
 */
export function manualControlTick(): number {
  const selectedId = useDroneManager.getState().selectedDroneId;
  if (sticksRouteToPilot(selectedId)) return pilotTick(Date.now());
  // Leaving the pilot route (mode change, stream closed) ends its session.
  sendPilotRelease();
  // An agent-connected drone takes RC overrides only in `fc_manual`.
  if (!sticksRouteToFc(selectedId)) return GATE_RECHECK_MS;
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const input = useInputStore.getState();
  const { axes, axesAt, buttons, activeController, manualControlEnabled } = input;
  const { armState, flightMode } = useDroneStore.getState();

  // A cloud-relayed link without a broker write grant has every stick frame
  // discarded by the broker, silently, so nothing is sent and the reason is
  // shown. A direct link, or no transport at all, is not the broker's call.
  const relay = selectedDroneMqttAuthority(Date.now());
  const relayBlocked = relay.reason !== "no-transport" && !canPublishFcFrames(relay);

  // Republish the link's own refusal whether or not the gate would let a frame
  // through, so an operator who has not armed yet still learns that arming
  // will not help.
  const linkBlock =
    protocol?.getManualControlBlockedReason?.() ?? (relayBlocked ? RELAY_WRITE_BLOCK : null);
  if (input.manualControlLinkBlock !== linkBlock) {
    input.setManualControlLinkBlock(linkBlock);
  }
  if (relayBlocked) return GATE_RECHECK_MS;

  const allowed = manualControlAllowed({
    enabled: manualControlEnabled,
    controller: activeController,
    connected: protocol?.isConnected === true,
    armState,
    flightMode,
  });
  if (!allowed || !protocol) return GATE_RECHECK_MS;
  // A pad whose axis order is unknown (non-standard layout) never flies.
  if (activeController === "gamepad" && usePadStatusStore.getState().needsCalibration) return GATE_RECHECK_MS;

  // SAMPLE LIVENESS. The sticks come from a `requestAnimationFrame` loop and
  // this tick is an independent `setTimeout` chain, so the two can diverge:
  // backgrounding the window pauses RAF entirely while Chrome keeps firing
  // hidden-tab timers at ~1 Hz — still inside ArduPilot's 3.0 s
  // `RC_OVERRIDE_TIME`, so the last stick snapshot was re-sent to an armed
  // aircraft indefinitely and the vehicle never saw a dropout. A gamepad
  // unplugged in that window was never noticed either. The gate's own doc
  // claims every condition it depends on is checked every frame; this is the
  // one that was missing.
  if (axesAt === null || Date.now() - axesAt > STALE_AXES_MS) {
    return GATE_RECHECK_MS;
  }

  const period = manualControlPeriodMs(protocol.getCapabilities().manualControlHz);
  if (period === null) return GATE_RECHECK_MS;

  // While an on-screen control has the sticks (the skill radial is open), the
  // stick deflection is aiming, not flying: roll and pitch go out centred and
  // throttle holds where it was when the capture began. In TX mode 1 the right
  // stick carries throttle, so passing it through would climb or sink the
  // aircraft while the operator picks a wedge.
  const [liveRoll, livePitch, liveThrottle, yaw] = axes;
  const captured = input.sticksCaptured;
  const roll = captured ? 0 : liveRoll;
  const pitch = captured ? 0 : livePitch;
  const throttleAxis = captured ? input.capturedThrottle : liveThrottle;

  // Convert boolean[] to bitmask. Buttons the cockpit owns (radial, stream
  // cycling, quick settings, exit) drive the GCS, not the aircraft, so they
  // never reach the autopilot as RC buttons.
  const bitmask = manualControlButtonMask(buttons);

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
  if (manualControlRequested) return;
  manualControlRequested = true;

  // Hidden-tab guard: RAF (the stick reader) stops, `setTimeout` (this
  // chain) does not. The listener lives as long as the request, so the
  // stream pauses while hidden and resumes when the tab is visible again.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (document.hidden) return;
  }
  scheduleManualControl();
}

/** Stop transmitting sticks. Leaves gamepad reading running. */
export function stopManualControlStream(): void {
  manualControlRequested = false;
  sendPilotRelease();
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  if (manualControlTimer === null) return;
  clearTimeout(manualControlTimer);
  manualControlTimer = null;
}

/**
 * The MANUAL_CONTROL button bitmask for a button frame: the first 16 buttons,
 * minus the ones the cockpit reserves for its own controls.
 */
export function manualControlButtonMask(buttons: readonly boolean[]): number {
  let bitmask = 0;
  for (let i = 0; i < Math.min(buttons.length, 16); i++) {
    if (buttons[i] && !isReservedGamepadButton(i)) bitmask |= 1 << i;
  }
  return bitmask;
}

let padListenersInstalled = false;

/** `gamepadconnected` / `gamepaddisconnected` drive the pad status. A pad
 * that disconnects releases the pilot sticks at once, without waiting for
 * the next read. */
function installPadListeners(): void {
  if (padListenersInstalled || typeof window === "undefined") return;
  padListenersInstalled = true;
  window.addEventListener("gamepadconnected", (e) => {
    const gp = (e as GamepadEvent).gamepad;
    patchPadStatus({ connected: true, seen: true, name: gp.id });
  });
  window.addEventListener("gamepaddisconnected", () => {
    lastPadUsable = false;
    lastPilotAxes = [0, 0, 0, 0];
    sendPilotRelease();
    patchPadStatus({ connected: false, usable: false, needsCalibration: false, name: null });
  });
}

/**
 * Stop reading the gamepad. Also stops the manual-control stream: once the
 * axes stop updating the last frame is stale, and a stale stick frame is not
 * something to keep transmitting.
 */
function stopPolling(): void {
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
