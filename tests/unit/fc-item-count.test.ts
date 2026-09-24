import { describe, it, expect } from 'vitest';
import {
  checkItemCount,
  expandedItemCount,
  fcFamilyFromFirmware,
  limitForFirmware,
  FC_ITEM_COUNT_LIMITS,
  DEFAULT_FC_ITEM_LIMIT,
  ITEM_COUNT_WARN_RATIO,
} from '@/lib/validation/fc-item-count';
import type { Waypoint } from '@/lib/types';

function wps(n: number): Waypoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `wp-${i}`,
    lat: 0,
    lon: 0,
    alt: 50,
    command: 'WAYPOINT' as const,
  }));
}

describe('expandedItemCount', () => {
  it('counts each waypoint as one item (HOME implicit, not counted)', () => {
    expect(expandedItemCount(wps(0))).toBe(0);
    expect(expandedItemCount(wps(1))).toBe(1);
    expect(expandedItemCount(wps(42))).toBe(42);
  });

  it('counts command-style waypoints as one item each', () => {
    const mixed: Waypoint[] = [
      { id: 'a', lat: 0, lon: 0, alt: 0, command: 'TAKEOFF' },
      { id: 'b', lat: 1, lon: 1, alt: 10, command: 'LOITER_TIME' },
      { id: 'c', lat: 2, lon: 2, alt: 10, command: 'DO_JUMP' },
      { id: 'd', lat: 3, lon: 3, alt: 0, command: 'LAND' },
    ];
    expect(expandedItemCount(mixed)).toBe(4);
  });

  it('counts each attached action as its own sibling item', () => {
    const withActions: Waypoint[] = [
      { id: 'a', lat: 0, lon: 0, alt: 0, command: 'TAKEOFF' },
      {
        id: 'b',
        lat: 1,
        lon: 1,
        alt: 10,
        command: 'WAYPOINT',
        actions: [
          { id: 'x', command: 'DO_SET_SPEED', param2: 5 },
          { id: 'y', command: 'CONDITION_YAW', param1: 90 },
        ],
      },
      { id: 'c', lat: 2, lon: 2, alt: 0, command: 'LAND' },
    ];
    // 3 NAV waypoints + 2 attached actions = 5 uploaded items.
    expect(expandedItemCount(withActions)).toBe(5);
  });

  it('is defensive against null / undefined input', () => {
    expect(expandedItemCount(null)).toBe(0);
    expect(expandedItemCount(undefined)).toBe(0);
  });
});

describe('fcFamilyFromFirmware', () => {
  it('maps every ArduPilot vehicle variant to the ardupilot family', () => {
    expect(fcFamilyFromFirmware('ardupilot-copter')).toBe('ardupilot');
    expect(fcFamilyFromFirmware('ardupilot-plane')).toBe('ardupilot');
    expect(fcFamilyFromFirmware('ardupilot-rover')).toBe('ardupilot');
    expect(fcFamilyFromFirmware('ardupilot-sub')).toBe('ardupilot');
  });

  it('maps px4 / betaflight / inav to their own families', () => {
    expect(fcFamilyFromFirmware('px4')).toBe('px4');
    expect(fcFamilyFromFirmware('betaflight')).toBe('betaflight');
    expect(fcFamilyFromFirmware('inav')).toBe('inav');
  });

  it('returns null for unknown firmware', () => {
    expect(fcFamilyFromFirmware('unknown')).toBeNull();
  });
});

describe('limitForFirmware', () => {
  it('resolves the per-family default ceiling', () => {
    expect(limitForFirmware('ardupilot-copter')).toBe(FC_ITEM_COUNT_LIMITS.ardupilot);
    expect(limitForFirmware('px4')).toBe(FC_ITEM_COUNT_LIMITS.px4);
    expect(limitForFirmware('inav')).toBe(FC_ITEM_COUNT_LIMITS.inav);
    expect(limitForFirmware('betaflight')).toBe(FC_ITEM_COUNT_LIMITS.betaflight);
  });

  it('falls back to the default ceiling for unknown firmware', () => {
    expect(limitForFirmware('unknown')).toBe(DEFAULT_FC_ITEM_LIMIT);
  });

  it('keeps betaflight/inav ceilings smaller than ardupilot', () => {
    expect(FC_ITEM_COUNT_LIMITS.betaflight).toBeLessThan(FC_ITEM_COUNT_LIMITS.ardupilot);
    expect(FC_ITEM_COUNT_LIMITS.inav).toBeLessThan(FC_ITEM_COUNT_LIMITS.ardupilot);
  });
});

describe('checkItemCount', () => {
  it('reports info well below the limit', () => {
    const result = checkItemCount(wps(10), { limit: 100 });
    expect(result).toEqual({ count: 10, limit: 100, level: 'info' });
  });

  it('escalates to warn once the count reaches the warn ratio', () => {
    // 90% of 100 = 90 → warn at 90+.
    expect(checkItemCount(wps(89), { limit: 100 }).level).toBe('info');
    expect(checkItemCount(wps(90), { limit: 100 }).level).toBe('warn');
  });

  it('warns when the count exceeds the limit but never errors', () => {
    const result = checkItemCount(wps(150), { limit: 100 });
    expect(result.count).toBe(150);
    expect(result.limit).toBe(100);
    expect(result.level).toBe('warn');
  });

  it('uses the firmware default ceiling when no explicit limit is given', () => {
    const result = checkItemCount(wps(5), { firmware: 'inav' });
    expect(result.limit).toBe(FC_ITEM_COUNT_LIMITS.inav);
  });

  it('warns near the iNav waypoint table ceiling', () => {
    // iNav holds 120 waypoints (NAV_MAX_WAYPOINTS), warn at >= 108.
    expect(checkItemCount(wps(107), { firmware: 'inav' }).level).toBe('info');
    expect(checkItemCount(wps(108), { firmware: 'inav' }).level).toBe('warn');
  });

  it('warns before a plan outgrows the default PX4 mission store', () => {
    // PX4 stores 500 items by default, warn at >= 450.
    expect(checkItemCount(wps(449), { firmware: 'px4' }).level).toBe('info');
    expect(checkItemCount(wps(450), { firmware: 'px4' }).level).toBe('warn');
  });

  it('lets an explicit limit override the firmware default', () => {
    const result = checkItemCount(wps(70), { firmware: 'inav', limit: 500 });
    expect(result.limit).toBe(500);
    expect(result.level).toBe('info');
  });

  it('falls back to the default ceiling when options are omitted', () => {
    const result = checkItemCount(wps(3));
    expect(result.limit).toBe(DEFAULT_FC_ITEM_LIMIT);
    expect(result.level).toBe('info');
  });

  it('ignores non-positive or non-finite explicit limits and falls back', () => {
    expect(checkItemCount(wps(1), { limit: 0 }).limit).toBe(DEFAULT_FC_ITEM_LIMIT);
    expect(checkItemCount(wps(1), { limit: -5 }).limit).toBe(DEFAULT_FC_ITEM_LIMIT);
    expect(checkItemCount(wps(1), { limit: Number.NaN }).limit).toBe(DEFAULT_FC_ITEM_LIMIT);
    expect(
      checkItemCount(wps(1), { limit: Number.POSITIVE_INFINITY, firmware: 'px4' }).limit,
    ).toBe(FC_ITEM_COUNT_LIMITS.px4);
  });

  it('treats an empty plan as an info advisory with zero count', () => {
    const result = checkItemCount([], { firmware: 'ardupilot-copter' });
    expect(result.count).toBe(0);
    expect(result.level).toBe('info');
  });

  it('exposes a warn ratio strictly between 0 and 1', () => {
    expect(ITEM_COUNT_WARN_RATIO).toBeGreaterThan(0);
    expect(ITEM_COUNT_WARN_RATIO).toBeLessThan(1);
  });
});
