/**
 * The mode list that decides whether a gamepad may fly.
 *
 * It is an allow list, so a mode nobody has classified blocks the stream
 * rather than opening it. These cases pin that direction: adding a mode to the
 * union without adding it here must leave the stream closed.
 */
import { describe, it, expect } from 'vitest';
import {
  manualControlAllowed,
  manualControlBlockedReason,
  STICK_AUTHORITY_MODES,
  type ManualControlGateInput,
} from '@/lib/input/manual-control-gate';
import type { FlightMode } from '@/lib/types';

const OPEN: ManualControlGateInput = {
  enabled: true,
  controller: 'gamepad',
  connected: true,
  armState: 'armed',
  flightMode: 'STABILIZE',
};

describe('manual-control gate', () => {
  it('opens only when every condition holds', () => {
    expect(manualControlAllowed(OPEN)).toBe(true);
    expect(manualControlBlockedReason(OPEN)).toBeNull();
  });

  it.each([
    ['the opt-in is off', { enabled: false }],
    ['no gamepad is reporting', { controller: 'keyboard' as const }],
    ['no drone is connected', { connected: false }],
    ['the aircraft is disarmed', { armState: 'disarmed' as const }],
  ])('stays closed when %s', (_label, override) => {
    const input = { ...OPEN, ...override };
    expect(manualControlAllowed(input)).toBe(false);
    expect(manualControlBlockedReason(input)).not.toBeNull();
  });

  it.each<FlightMode>(['AUTO', 'GUIDED', 'RTL', 'LAND', 'SMART_RTL', 'AUTO_RTL', 'QRTL', 'QLAND', 'CIRCLE', 'AUTOTUNE'])(
    'stays closed in %s, which the autopilot is flying',
    (flightMode) => {
      expect(manualControlAllowed({ ...OPEN, flightMode })).toBe(false);
    },
  );

  it.each<FlightMode>(['STABILIZE', 'ACRO', 'ALT_HOLD', 'MANUAL', 'POSHOLD', 'QHOVER'])(
    'opens in %s, where the pilot holds the sticks',
    (flightMode) => {
      expect(manualControlAllowed({ ...OPEN, flightMode })).toBe(true);
    },
  );

  it('names no autonomous mode as carrying stick authority', () => {
    for (const mode of ['AUTO', 'GUIDED', 'RTL', 'LAND', 'SMART_RTL', 'AUTO_RTL'] as FlightMode[]) {
      expect(STICK_AUTHORITY_MODES.has(mode)).toBe(false);
    }
  });
});
