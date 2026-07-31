/**
 * The manual-control stream is an RC override, so it needs a reason to run.
 *
 * On an MSP flight controller the same 50 Hz frame that carries the sticks
 * carries every AUX channel with them, so an override that opens on its own is
 * an override that can arm the aircraft. These tests pin the conditions: the
 * operator has to opt in, a gamepad has to actually be reporting, the aircraft
 * has to be armed, and the mode has to be one where the pilot holds the
 * sticks. They also pin the separation between reading a gamepad and
 * transmitting one, because a keybinding panel needs the former and must never
 * open the latter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sendManualControl = vi.fn();
const protocol = { isConnected: true, sendManualControl };

vi.mock('@/stores/drone-manager', () => ({
  useDroneManager: {
    getState: () => ({ getSelectedProtocol: () => protocol }),
  },
}));

import {
  startGamepadPolling,
  stopGamepadPolling,
  startManualControlStream,
  stopManualControlStream,
} from '@/lib/input/gamepad-poller';
import { useInputStore } from '@/stores/input-store';
import { useDroneStore } from '@/stores/drone-store';

function fakePad(axes: number[] = [0, 0, 0, 0]): Gamepad {
  return {
    axes,
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
    connected: true,
    id: 'test pad',
    index: 0,
    mapping: 'standard',
    timestamp: 0,
  } as unknown as Gamepad;
}

/** Put every gate condition in the "allowed" position. */
function allowEverything() {
  useInputStore.getState().setManualControlEnabled(true);
  useInputStore.getState().setController('gamepad');
  useDroneStore.getState().setArmState('armed');
  useDroneStore.getState().setFlightMode('STABILIZE');
  protocol.isConnected = true;
}

describe('manual-control stream gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendManualControl.mockClear();
    navigator.getGamepads = () => [fakePad()] as unknown as ReturnType<Navigator['getGamepads']>;
    useInputStore.getState().resetInput();
    useInputStore.getState().setManualControlEnabled(false);
    useDroneStore.getState().setArmState('disarmed');
    useDroneStore.getState().setFlightMode('STABILIZE');
  });

  afterEach(() => {
    stopManualControlStream();
    stopGamepadPolling();
    vi.useRealTimers();
  });

  it('reading a gamepad does not transmit one', () => {
    startGamepadPolling();
    allowEverything();
    vi.advanceTimersByTime(500);
    expect(sendManualControl).not.toHaveBeenCalled();
  });

  it('transmits once every condition is met', () => {
    startManualControlStream();
    allowEverything();
    vi.advanceTimersByTime(200);
    expect(sendManualControl).toHaveBeenCalled();
  });

  it('holds off until the operator opts in', () => {
    startManualControlStream();
    allowEverything();
    useInputStore.getState().setManualControlEnabled(false);
    vi.advanceTimersByTime(200);
    expect(sendManualControl).not.toHaveBeenCalled();
  });

  it('holds off while the aircraft is disarmed', () => {
    startManualControlStream();
    allowEverything();
    useDroneStore.getState().setArmState('disarmed');
    vi.advanceTimersByTime(200);
    expect(sendManualControl).not.toHaveBeenCalled();
  });

  it('holds off in a mode the autopilot is flying', () => {
    startManualControlStream();
    allowEverything();
    useDroneStore.getState().setFlightMode('AUTO');
    vi.advanceTimersByTime(200);
    expect(sendManualControl).not.toHaveBeenCalled();
  });

  it('holds off when no gamepad is reporting', () => {
    startManualControlStream();
    allowEverything();
    useInputStore.getState().setController('none');
    vi.advanceTimersByTime(200);
    expect(sendManualControl).not.toHaveBeenCalled();
  });

  it('stops transmitting when the gamepad reader stops', () => {
    startGamepadPolling();
    startManualControlStream();
    allowEverything();
    vi.advanceTimersByTime(100);
    expect(sendManualControl).toHaveBeenCalled();

    sendManualControl.mockClear();
    stopGamepadPolling();
    vi.advanceTimersByTime(200);
    expect(sendManualControl).not.toHaveBeenCalled();
  });

  it('hands throttle over in the 0..1 range the protocol documents', () => {
    startManualControlStream();
    allowEverything();
    // Throttle stick fully down reads -1 on the bipolar axis.
    useInputStore.getState().setAxes([0, 0, -1, 0]);
    vi.advanceTimersByTime(40);

    expect(sendManualControl).toHaveBeenCalled();
    const throttle = sendManualControl.mock.calls[0][2];
    expect(throttle).toBe(0);
  });
});
