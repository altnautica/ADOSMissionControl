/**
 * Demo-mode control-output seam.
 *
 * `sendManualControl` is the fire-and-forget stick output on `DroneProtocol`.
 * It returns void, so if the mocks discard their arguments there is no way to
 * assert what a caller actually emitted — a caller passing the wrong scale, or
 * nothing at all, looks identical to a correct one. These tests pin the
 * recording seam so the stick-scale contract is testable at all.
 */
import { describe, it, expect } from 'vitest';
import { MockProtocol } from '@/mock/mock-protocol';
import { INavMockProtocol } from '@/mock/inav-mock-protocol';

describe('MockProtocol control outputs', () => {
  it('records the manual-control frame it was handed', () => {
    const p = new MockProtocol('ardupilot-copter');
    expect(p.getLastManualControl()).toBeNull();

    p.sendManualControl(0.5, -0.25, 0.75, -1, 0b1010);

    expect(p.getLastManualControl()).toEqual({
      roll: 0.5, pitch: -0.25, throttle: 0.75, yaw: -1, buttons: 0b1010,
    });
    p.disconnect();
  });
});

describe('INavMockProtocol control outputs', () => {
  it('records the manual-control frame it was handed', () => {
    const p = new INavMockProtocol({ vehicleClass: 'copter' });
    expect(p.getLastManualControl()).toBeNull();

    p.sendManualControl(-1, 1, 0, 0.5, 0);

    expect(p.getLastManualControl()).toEqual({
      roll: -1, pitch: 1, throttle: 0, yaw: 0.5, buttons: 0,
    });
  });
});
