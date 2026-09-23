import { describe, it, expect } from 'vitest';
import { parseCSV, exportCSV } from '@/lib/formats/csv-handler';
import type { Waypoint } from '@/lib/types/mission';

describe('parseCSV', () => {
  it('parses simple CSV with lat,lon,alt columns', () => {
    const csv = `seq,lat,lon,alt,command
1,12.97,77.59,50,WAYPOINT
2,12.98,77.60,60,LAND`;
    const waypoints = parseCSV(csv);
    expect(waypoints).toHaveLength(2);
    expect(waypoints[0].lat).toBeCloseTo(12.97);
    expect(waypoints[0].lon).toBeCloseTo(77.59);
    expect(waypoints[0].alt).toBe(50);
    expect(waypoints[0].command).toBe('WAYPOINT');
    expect(waypoints[1].command).toBe('LAND');
  });

  it('parses CSV with different column orderings', () => {
    const csv = `command,lon,lat,alt
TAKEOFF,77.59,12.97,30
WAYPOINT,77.60,12.98,50`;
    const waypoints = parseCSV(csv);
    expect(waypoints).toHaveLength(2);
    expect(waypoints[0].lat).toBeCloseTo(12.97);
    expect(waypoints[0].lon).toBeCloseTo(77.59);
    expect(waypoints[0].command).toBe('TAKEOFF');
  });

  it('round-trips: export then re-parse', () => {
    const original: Waypoint[] = [
      { id: 'a', lat: 12.97, lon: 77.59, alt: 50, command: 'TAKEOFF', speed: 5 },
      { id: 'b', lat: 12.98, lon: 77.60, alt: 60, command: 'WAYPOINT' },
      { id: 'c', lat: 12.99, lon: 77.61, alt: 40, command: 'LAND' },
    ];
    const csv = exportCSV(original);
    const parsed = parseCSV(csv);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].lat).toBeCloseTo(12.97);
    expect(parsed[0].command).toBe('TAKEOFF');
    expect(parsed[0].speed).toBe(5);
    expect(parsed[2].command).toBe('LAND');
  });

  it('handles missing optional columns', () => {
    const csv = `lat,lon
12.97,77.59
12.98,77.60`;
    const waypoints = parseCSV(csv);
    expect(waypoints).toHaveLength(2);
    expect(waypoints[0].alt).toBe(0);
    expect(waypoints[0].command).toBe('WAYPOINT');
    expect(waypoints[0].speed).toBeUndefined();
  });

  it('handles empty input', () => {
    expect(parseCSV('')).toEqual([]);
  });

  it('handles header-only input', () => {
    expect(parseCSV('lat,lon,alt')).toEqual([]);
  });
});

describe('exportCSV', () => {
  it('produces correct header and data rows', () => {
    const waypoints: Waypoint[] = [
      { id: 'x', lat: 12.97, lon: 77.59, alt: 50, command: 'TAKEOFF' },
    ];
    const csv = exportCSV(waypoints);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('lat');
    expect(lines[0]).toContain('lon');
    expect(lines[0]).toContain('alt');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('12.97');
  });

  it('includes a frame column in the header', () => {
    const csv = exportCSV([{ id: 'x', lat: 12.97, lon: 77.59, alt: 50, command: 'WAYPOINT' }]);
    expect(csv.split('\n')[0]).toContain('frame');
  });
});

describe('frame + full-command-set round-trip', () => {
  it('preserves the frame column and commands outside the legacy subset', () => {
    const original: Waypoint[] = [
      // VTOL_TAKEOFF + DO_LAND_START were previously coerced to WAYPOINT on import.
      { id: 'a', lat: 12.97, lon: 77.59, alt: 50, command: 'VTOL_TAKEOFF', frame: 'absolute' },
      { id: 'b', lat: 12.98, lon: 77.60, alt: 60, command: 'DO_LAND_START', frame: 'terrain' },
      { id: 'c', lat: 12.99, lon: 77.61, alt: 40, command: 'WAYPOINT', frame: 'relative' },
    ];
    const parsed = parseCSV(exportCSV(original));
    expect(parsed).toHaveLength(3);

    expect(parsed[0].command).toBe('VTOL_TAKEOFF');
    expect(parsed[0].frame).toBe('absolute');

    expect(parsed[1].command).toBe('DO_LAND_START');
    expect(parsed[1].frame).toBe('terrain');

    expect(parsed[2].command).toBe('WAYPOINT');
    expect(parsed[2].frame).toBe('relative');
  });

  it('leaves frame undefined when the column is absent or blank', () => {
    const noFrame: Waypoint[] = [{ id: 'a', lat: 12.97, lon: 77.59, alt: 50, command: 'WAYPOINT' }];
    const parsed = parseCSV(exportCSV(noFrame));
    expect(parsed[0].frame).toBeUndefined();
  });

  it('round-trips nested actions and a retargeted DO_JUMP', () => {
    const original: Waypoint[] = [
      { id: 'wp-0', lat: 12.9716, lon: 77.5946, alt: 0, command: 'TAKEOFF' },
      {
        id: 'wp-1', lat: 12.972, lon: 77.595, alt: 50, command: 'WAYPOINT',
        actions: [{ id: 'a-spd', command: 'DO_SET_SPEED', param1: 1, param2: 8 }],
      },
      {
        id: 'wp-2', lat: 12.973, lon: 77.596, alt: 50, command: 'LAND',
        actions: [{ id: 'a-jmp', command: 'DO_JUMP', jumpTargetId: 'wp-1', param2: 2 }],
      },
    ];
    const parsed = parseCSV(exportCSV(original));
    expect(parsed.map((w) => w.command)).toEqual(['TAKEOFF', 'WAYPOINT', 'LAND']);
    expect(parsed[1].actions?.[0].command).toBe('DO_SET_SPEED');
    const jump = parsed[2].actions?.[0];
    expect(jump?.command).toBe('DO_JUMP');
    expect(jump?.command === 'DO_JUMP' ? jump.jumpTargetId : undefined).toBe(parsed[1].id);
  });

});
