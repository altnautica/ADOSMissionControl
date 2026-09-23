import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBattery } from '@/lib/protocol/handlers/telemetry-handlers';
import type { BatteryCallback, DroneProtocol } from '@/lib/protocol/types';

const recordFrameFor = vi.hoisted(() => vi.fn());
vi.mock('@/lib/telemetry-recorder', () => ({ recordFrameFor }));

import { bridgeTelemetry } from '@/stores/drone-manager-bridge';
import { useDroneManager } from '@/stores/drone-manager';
import { useTelemetryStore } from '@/stores/telemetry-store';

type Battery = Parameters<BatteryCallback>[0];

/**
 * BATTERY_STATUS (147) payload, 54 bytes, MAVLink wire order:
 * current_consumed i32 @0, energy_consumed i32 @4, temperature i16 @8,
 * voltages u16[10] @10, current_battery i16 @30, id u8 @32, battery_function u8 @33,
 * type u8 @34, battery_remaining i8 @35, time_remaining i32 @36, charge_state u8 @40,
 * voltages_ext u16[4] @41.
 */
function batteryStatus(opts: {
  id?: number;
  cellsMv: number[];
  extMv?: number[];
  currentCa?: number;
  consumedMah?: number;
  remaining?: number;
}): DataView {
  const dv = new DataView(new ArrayBuffer(54));
  dv.setInt32(0, opts.consumedMah ?? 1200, true);
  dv.setInt16(8, 32767, true);
  for (let i = 0; i < 10; i++) dv.setUint16(10 + i * 2, opts.cellsMv[i] ?? 0xffff, true);
  dv.setInt16(30, opts.currentCa ?? 1250, true);
  dv.setUint8(32, opts.id ?? 0);
  dv.setInt8(35, opts.remaining ?? 80);
  (opts.extMv ?? []).forEach((mv, i) => dv.setUint16(41 + i * 2, mv, true));
  return dv;
}

function decode(dv: DataView): Battery {
  const cb = vi.fn<BatteryCallback>();
  handleBattery(dv, [cb]);
  return cb.mock.calls[0][0];
}

describe('handleBattery (BATTERY_STATUS)', () => {
  it('reports the battery instance id', () => {
    expect(decode(batteryStatus({ id: 1, cellsMv: [5100] })).id).toBe(1);
  });

  it('adds cells 11-14 from voltages_ext to the pack voltage and cell list', () => {
    const b = decode(batteryStatus({ cellsMv: Array(10).fill(3700), extMv: [3700, 3700] }));
    expect(b.voltage).toBeCloseTo(44.4, 3);
    expect(b.cellVoltages).toHaveLength(12);
    expect(b.cellCount).toBe(12);
  });

  it('treats a pack total in cell 0 as the pack voltage, not a single cell', () => {
    const b = decode(batteryStatus({ cellsMv: [22200] }));
    expect(b.voltage).toBeCloseTo(22.2, 3);
    expect(b.cellVoltages).toBeUndefined();
  });

  it('sums a pack total split across slots above 65.534 V without calling the slots cells', () => {
    const b = decode(batteryStatus({ cellsMv: [0xfffe, 4466] }));
    expect(b.voltage).toBeCloseTo(70, 3);
    expect(b.cellVoltages).toBeUndefined();
  });

  it('maps the -1 current and consumed sentinels to unknown', () => {
    const b = decode(batteryStatus({ cellsMv: [22200], currentCa: -1, consumedMah: -1 }));
    expect(b.current).toBeUndefined();
    expect(b.consumed).toBeUndefined();
  });
});

describe('bridgeTelemetry battery routing', () => {
  let battery: BatteryCallback | null = null;

  beforeEach(() => {
    recordFrameFor.mockClear();
    useTelemetryStore.getState().clear?.();
    useDroneManager.setState({ selectedDroneId: 'd1' });
    battery = null;
  });

  function fakeProtocol(): DroneProtocol {
    const noop = () => () => {};
    return new Proxy({} as DroneProtocol, {
      get: (_t, key) => {
        if (key === 'onBattery') return (cb: BatteryCallback) => { battery = cb; return () => {}; };
        if (typeof key === 'string' && key.startsWith('on')) return noop;
        return undefined;
      },
    });
  }

  it('feeds only the primary pack to the live battery and records other monitors on their own channel', () => {
    bridgeTelemetry('d1', 'Drone 1', fakeProtocol());
    expect(battery).not.toBeNull();
    const base = { timestamp: 1, current: 12, remaining: 78, consumed: 900 };
    battery!({ ...base, id: 0, voltage: 22.4 });
    battery!({ ...base, id: 1, voltage: 5.1, remaining: -1 });

    const ring = useTelemetryStore.getState().battery.toArray();
    expect(ring.map((b) => b.voltage)).toEqual([22.4]);
    const channels = recordFrameFor.mock.calls.map((c) => c[1]);
    expect(channels).toEqual(['battery', 'battery2']);
  });
});
