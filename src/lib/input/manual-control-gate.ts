/**
 * When a gamepad is allowed to drive the aircraft.
 *
 * The manual-control stream is an RC override: it writes the sticks at 50 Hz
 * and, on an MSP flight controller, it writes every RC channel with them. It
 * is not something to leave running because a component happened to mount, so
 * every condition it depends on is stated here and checked on every frame.
 *
 * The mode list is an allow list rather than a deny list on purpose. A mode we
 * have not classified must block the stream, not open it.
 *
 * @module lib/input/manual-control-gate
 */

import type { ArmState, FlightMode, InputController } from '@/lib/types';

/**
 * Modes in which the pilot holds direct stick authority. In anything else the
 * autopilot is flying and injected sticks either fight it or do nothing.
 */
export const STICK_AUTHORITY_MODES: ReadonlySet<FlightMode> = new Set<FlightMode>([
  'STABILIZE',
  'ACRO',
  'ALT_HOLD',
  'MANUAL',
  'POSHOLD',
  'LOITER',
  'SPORT',
  'DRIFT',
  'FLOWHOLD',
  'FBWA',
  'FBWB',
  'CRUISE',
  'TRAINING',
  'QSTABILIZE',
  'QHOVER',
  'QLOITER',
  'QACRO',
]);

export interface ManualControlGateInput {
  /** The operator opted in to stick control for this session. */
  enabled: boolean;
  /** Which input device the poller is actually reading. */
  controller: InputController;
  /** The selected drone has a live protocol link. */
  connected: boolean;
  armState: ArmState;
  flightMode: FlightMode;
}

/** Why the stream is held off, or null when every condition is met. */
export function manualControlBlockedReason(i: ManualControlGateInput): string | null {
  if (!i.enabled) return 'stick control is off';
  if (i.controller !== 'gamepad') return 'no gamepad is reporting';
  if (!i.connected) return 'no drone is connected';
  if (i.armState !== 'armed') return 'the aircraft is disarmed';
  if (!STICK_AUTHORITY_MODES.has(i.flightMode)) {
    return `${i.flightMode} does not give the pilot stick authority`;
  }
  return null;
}

/** True when a stick frame may be transmitted right now. */
export function manualControlAllowed(i: ManualControlGateInput): boolean {
  return manualControlBlockedReason(i) === null;
}
