import { describe, it, expect } from 'vitest';
import { validateMission } from '@/lib/validation/mission-validator';
import type { ValidationOptions } from '@/lib/validation/issue-types';
import type { PlanVehicleProfile, Waypoint } from '@/lib/types/mission';

const ARDUCOPTER: PlanVehicleProfile = { autopilot: 'ardupilot', vehicleClass: 'copter' };
const ARDUPLANE: PlanVehicleProfile = { autopilot: 'ardupilot', vehicleClass: 'plane' };
const PX4_COPTER: PlanVehicleProfile = { autopilot: 'px4', vehicleClass: 'copter' };

let seq = 0;
function wp(overrides: Partial<Waypoint> & { lat: number; lon: number }): Waypoint {
  return { id: `w${++seq}`, alt: 50, command: 'WAYPOINT', ...overrides };
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

/** TAKEOFF, two waypoints and LAND around Bangalore, 100 m MSL ground everywhere. */
function simpleMission(): Waypoint[] {
  return [
    wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF', groundElevation: 100 }),
    wp({ lat: 12.971, lon: 77.59, alt: 50, groundElevation: 100 }),
    wp({ lat: 12.972, lon: 77.59, alt: 50, groundElevation: 100 }),
    wp({ lat: 12.973, lon: 77.59, alt: 0, command: 'LAND', groundElevation: 100 }),
  ];
}

describe('validateMission — planned home datum', () => {
  it('measures link range from the planned home, wherever it is', () => {
    const mission = simpleMission();
    const far = validateMission(mission, { linkRangeM: 1000, home: { lat: 13.1, lon: 77.59, groundElevation: 100 } });
    expect(codes(far.warnings)).toContain('OUTSIDE_LINK_RANGE');
    const near = validateMission(mission, { linkRangeM: 1000, home: { lat: 12.97, lon: 77.59, groundElevation: 100 } });
    expect(codes(near.warnings)).not.toContain('OUTSIDE_LINK_RANGE');
  });

  it('falls back to the launch point, not a 0/0 first item, and a 0/0 TAKEOFF is not out of range', () => {
    const mission = [
      wp({ lat: 0, lon: 0, alt: 30, command: 'TAKEOFF' }),
      wp({ lat: 12.97, lon: 77.59 }),
      wp({ lat: 12.971, lon: 77.59, command: 'LAND' }),
    ];
    const result = validateMission(mission, { linkRangeM: 1000 });
    expect(codes(result.warnings)).not.toContain('OUTSIDE_LINK_RANGE');
    expect(codes(result.warnings)).not.toContain('LEG_EXCEEDS_LINK_RANGE');
    expect(codes(result.warnings)).not.toContain('EXCESSIVE_DISTANCE');
  });

  it('skips the link-range rule when there is no launch point at all', () => {
    const result = validateMission(
      [wp({ lat: 0, lon: 0, alt: 30, command: 'TAKEOFF' }), wp({ lat: 0, lon: 0, alt: 0, command: 'RTL' })],
      { linkRangeM: 10 },
    );
    expect(codes(result.warnings)).not.toContain('OUTSIDE_LINK_RANGE');
  });

  it('resolves relative altitudes against the planned home ground', () => {
    // 60 m above a home on 100 m ground is 160 m MSL; over 200 m ground that is underground.
    const mission = [
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }),
      wp({ lat: 12.971, lon: 77.59, alt: 60, frame: 'relative', groundElevation: 200 }),
      wp({ lat: 12.972, lon: 77.59, alt: 0, command: 'LAND' }),
    ];
    const result = validateMission(mission, { home: { lat: 12.97, lon: 77.59, groundElevation: 100 } });
    expect(codes(result.errors)).toContain('TERRAIN_CLEARANCE');
  });
});

describe('validateMission — terrain between waypoints', () => {
  // Two waypoints 60 m above home either side of a hill 80 m above home, ~600 m apart.
  const home = { lat: 12.97, lon: 77.59, groundElevation: 100 };
  const hillMission = () => {
    const takeoff = wp({ lat: 12.97, lon: 77.59, alt: 60, command: 'TAKEOFF', groundElevation: 100 });
    const far = wp({ lat: 12.97, lon: 77.5955, alt: 60, groundElevation: 100 });
    const land = wp({ lat: 12.971, lon: 77.5955, alt: 0, command: 'LAND', groundElevation: 100 });
    return { takeoff, far, land, mission: [takeoff, far, land] };
  };
  const hill = Array.from({ length: 21 }, (_, k) => (k >= 9 && k <= 11 ? 180 : 100));
  const flat = (n: number) => Array.from({ length: n }, () => 100);

  it('blocks a leg that crosses a hill the waypoints clear', () => {
    const { takeoff, far, land, mission } = hillMission();
    const profiles = new Map([[`${takeoff.id}>${far.id}`, hill], [`${far.id}>${land.id}`, flat(5)]]);
    const result = validateMission(mission, { home, legGroundProfiles: profiles });
    const issue = result.errors.find((e) => e.code === 'LEG_TERRAIN_CLEARANCE');
    expect(issue?.severity).toBe('blocking');
    expect(issue?.waypointId).toBe(takeoff.id);
    expect(issue?.leg?.toWaypointId).toBe(far.id);
    expect(issue?.leg?.clearanceM).toBeCloseTo(-20, 5);
    expect(issue?.leg?.alongM).toBeGreaterThan(250);
    expect(issue?.leg?.alongM).toBeLessThan(350);
    expect(codes(result.warnings)).not.toContain('LEG_TERRAIN_UNCHECKED');
  });

  it('passes the same leg over flat ground', () => {
    const { takeoff, far, land, mission } = hillMission();
    const profiles = new Map([[`${takeoff.id}>${far.id}`, flat(21)], [`${far.id}>${land.id}`, flat(5)]]);
    const result = validateMission(mission, { home, legGroundProfiles: profiles });
    expect(codes(result.errors)).not.toContain('LEG_TERRAIN_CLEARANCE');
    expect(codes(result.warnings)).not.toContain('LEG_TERRAIN_UNCHECKED');
  });

  it('reports a leg without a profile as unchecked, never as clear', () => {
    const { takeoff, far, mission } = hillMission();
    const result = validateMission(mission, { home, legGroundProfiles: new Map([[`${takeoff.id}>${far.id}`, hill]]) });
    const unchecked = result.warnings.find((w) => w.code === 'LEG_TERRAIN_UNCHECKED');
    expect(unchecked?.severity).toBe('advisory');
    expect(unchecked?.waypointId).toBe(far.id);
    const none = validateMission(mission, { home });
    expect(codes(none.warnings)).toContain('LEG_TERRAIN_UNCHECKED');
  });

  it('flies the leg into LAND level and ignores the descent at the landing point', () => {
    const { takeoff, far, land, mission } = hillMission();
    const profiles = new Map([[`${takeoff.id}>${far.id}`, flat(21)], [`${far.id}>${land.id}`, flat(5)]]);
    const result = validateMission(mission, { home, legGroundProfiles: profiles });
    expect(result.errors.filter((e) => e.code === 'LEG_TERRAIN_CLEARANCE')).toHaveLength(0);
  });

  it('measures legs across a DO_LAND_START, which is not a point the vehicle flies to', () => {
    const a = wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF', groundElevation: 100 });
    const marker = wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'DO_LAND_START' });
    const b = wp({ lat: 12.97, lon: 77.5955, alt: 30, groundElevation: 100 });
    const land = wp({ lat: 12.971, lon: 77.5955, alt: 0, command: 'LAND', groundElevation: 100 });
    const profiles = new Map([[`${a.id}>${b.id}`, hill], [`${b.id}>${land.id}`, flat(5)]]);
    const result = validateMission([a, marker, b, land], { home, legGroundProfiles: profiles });
    expect(result.errors.find((e) => e.code === 'LEG_TERRAIN_CLEARANCE')?.leg?.toWaypointId).toBe(b.id);
    expect(codes(result.warnings)).not.toContain('DUPLICATE_WAYPOINT');
    expect(codes(result.warnings)).not.toContain('LEG_TERRAIN_UNCHECKED');
  });
});

describe('validateMission — positionless items', () => {
  it('does not measure a 0/0 or stand-in RTL as a duplicate point', () => {
    const last = wp({ lat: 12.972, lon: 77.59 });
    const rtl = wp({ lat: 12.972, lon: 77.59, alt: 0, command: 'RTL', inheritsPosition: true });
    const result = validateMission([wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }), last, rtl]);
    expect(codes(result.warnings)).not.toContain('DUPLICATE_WAYPOINT');
  });
});

describe('validateMission — clearance message', () => {
  it('says the ground is unknown instead of printing 0 m MSL', () => {
    const result = validateMission([
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }),
      wp({ lat: 12.971, lon: 77.59, alt: 2, frame: 'terrain' }),
      wp({ lat: 12.972, lon: 77.59, alt: 0, command: 'LAND' }),
    ]);
    const issue = result.errors.find((e) => e.code === 'TERRAIN_CLEARANCE');
    expect(issue?.message).toContain('Ground unknown');
    expect(issue?.message).not.toContain('0m MSL');
  });
});

describe('validateMission — PX4 rules', () => {
  const px4: ValidationOptions = { profile: PX4_COPTER };

  it('blocks a terrain-frame waypoint, including through the default frame', () => {
    const own = validateMission(
      [wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }), wp({ lat: 12.971, lon: 77.59, alt: 40, frame: 'terrain' })],
      px4,
    );
    const issue = own.errors.find((e) => e.code === 'TERRAIN_FRAME_UNSUPPORTED');
    expect(issue?.severity).toBe('blocking');
    expect(issue?.waypointIndex).toBe(1);
    const viaDefault = validateMission(simpleMission(), { ...px4, defaultFrame: 'terrain' });
    expect(viaDefault.errors.filter((e) => e.code === 'TERRAIN_FRAME_UNSUPPORTED').length).toBeGreaterThan(0);
    // ArduPilot accepts the frame.
    expect(codes(validateMission(simpleMission(), { profile: ARDUCOPTER, defaultFrame: 'terrain' }).errors))
      .not.toContain('TERRAIN_FRAME_UNSUPPORTED');
  });

  it('blocks a forward DO_JUMP and a negative repeat other than -1', () => {
    const mission = [
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }),
      wp({ lat: 12.971, lon: 77.59 }),
      wp({ lat: 12.972, lon: 77.59 }),
      wp({ lat: 12.973, lon: 77.59 }),
      wp({ lat: 12.974, lon: 77.59 }),
      wp({ lat: 12.975, lon: 77.59, alt: 0, command: 'LAND' }),
    ];
    mission[1] = { ...mission[1], actions: [{ id: 'j', command: 'DO_JUMP', jumpTargetId: mission[4].id, param2: 1 }] };
    expect(codes(validateMission(mission, px4).errors)).toContain('JUMP_FORWARD_UNSUPPORTED');
    // The same forward jump is fine on ArduPilot.
    expect(codes(validateMission(mission, { profile: ARDUCOPTER }).errors)).not.toContain('JUMP_FORWARD_UNSUPPORTED');

    mission[1] = { ...mission[1], actions: [{ id: 'j', command: 'DO_JUMP', jumpTargetId: mission[0].id, param2: -2 }] };
    expect(codes(validateMission(mission, px4).errors)).toContain('JUMP_REPEAT_INVALID');
  });

  it('treats a mission starting airborne as advisory, since PX4 climbs first', () => {
    const mission = [wp({ lat: 12.97, lon: 77.59, alt: 50, frame: 'relative' }), wp({ lat: 12.971, lon: 77.59, command: 'LAND' })];
    const result = validateMission(mission, px4);
    const issue = result.warnings.find((w) => w.code === 'MISSING_TAKEOFF');
    expect(issue?.severity).toBe('advisory');
    expect(issue?.message).toContain('PX4 climbs to MIS_TAKEOFF_ALT first');
    expect(codes(result.errors)).not.toContain('MISSING_TAKEOFF');
  });

  it('blocks a fence over 64 items and more than 32 rally points', () => {
    const ring: [number, number][] = Array.from({ length: 65 }, (_, k) => {
      const a = (2 * Math.PI * k) / 65;
      return [12.97 + 0.05 * Math.cos(a), 77.59 + 0.05 * Math.sin(a)];
    });
    const rally = Array.from({ length: 33 }, (_, k) => ({ id: `r${k}`, lat: 12.97 + k * 1e-4, lon: 77.59, alt: 40 }));
    const result = validateMission(simpleMission(), { ...px4, geofence: { polygonPoints: ring }, rally });
    expect(codes(result.errors)).toContain('FENCE_TOO_MANY_ITEMS');
    expect(codes(result.errors)).toContain('RALLY_TOO_MANY_POINTS');
    const ok = validateMission(simpleMission(), { ...px4, geofence: { polygonPoints: ring.slice(0, 64) }, rally: rally.slice(0, 32) });
    expect(codes(ok.errors)).not.toContain('FENCE_TOO_MANY_ITEMS');
    expect(codes(ok.errors)).not.toContain('RALLY_TOO_MANY_POINTS');
  });
});

describe('validateMission — ArduPilot rules', () => {
  /** A TAKEOFF, `n` waypoints a few metres apart and a LAND. */
  function longMission(n: number): Waypoint[] {
    return [
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }),
      ...Array.from({ length: n }, (_, k) => wp({ lat: 12.97 + (k + 1) * 1e-5, lon: 77.59 })),
      wp({ lat: 12.99, lon: 77.59, alt: 0, command: 'LAND' }),
    ];
  }

  it('counts expanded items with home and names the board storage classes', () => {
    // 638 waypoints + TAKEOFF + LAND, 15 speed changes, + home = 656 items.
    const mission = longMission(638).map((w, i) => (i > 0 && i % 40 === 0 ? { ...w, speed: i % 80 === 0 ? 5 : 8 } : w));
    const result = validateMission(mission, { profile: ARDUCOPTER });
    const issue = result.warnings.find((w) => w.code === 'ITEM_COUNT_STORAGE');
    expect(issue?.message).toContain('656 items');
    expect(issue?.message).toContain('~300 on 8 KB boards');
    expect(issue?.message).toContain('~650 on 16 KB boards');
    expect(issue?.message).toContain('~1,300 on 32 KB boards');
    expect(codes(result.errors)).not.toContain('ITEM_COUNT_EXCEEDED');

    const huge = validateMission(longMission(1300), { profile: ARDUCOPTER });
    expect(codes(huge.errors)).toContain('ITEM_COUNT_EXCEEDED');
    expect(codes(validateMission(longMission(10), { profile: ARDUCOPTER }).warnings)).not.toContain('ITEM_COUNT_STORAGE');
  });

  it('blocks a waypoint outside the home circle fence', () => {
    const mission = [
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }),
      wp({ lat: 12.9745, lon: 77.59 }), // ~500 m north
      wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'LAND' }),
    ];
    const opts: ValidationOptions = { profile: ARDUCOPTER, home: { lat: 12.97, lon: 77.59 }, homeCircleRadiusM: 300 };
    const issue = validateMission(mission, opts).errors.find((e) => e.code === 'OUTSIDE_HOME_CIRCLE_FENCE');
    expect(issue?.waypointIndex).toBe(1);
    expect(codes(validateMission(mission, { ...opts, homeCircleRadiusM: 600 }).errors)).not.toContain('OUTSIDE_HOME_CIRCLE_FENCE');
  });

  it('says terrain-frame waypoints need terrain data, and blocks when TERRAIN_ENABLE is 0', () => {
    const opts: ValidationOptions = { profile: ARDUCOPTER, defaultFrame: 'terrain' };
    const advisory = validateMission(simpleMission(), opts).warnings.find((w) => w.code === 'TERRAIN_DATA_SOURCE');
    expect(advisory?.message).toBe('Needs terrain data on the vehicle (TERRAIN_ENABLE and SD card or GCS terrain)');
    const off = validateMission(simpleMission(), { ...opts, terrainEnabled: false });
    expect(off.errors.find((e) => e.code === 'TERRAIN_DATA_SOURCE')?.severity).toBe('blocking');
    expect(codes(validateMission(simpleMission(), { profile: ARDUCOPTER }).warnings)).not.toContain('TERRAIN_DATA_SOURCE');
  });

  it('holds the previous altitude for an ArduCopter waypoint at altitude 0', () => {
    const mission = [
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF', groundElevation: 100 }),
      wp({ lat: 12.971, lon: 77.59, alt: 50, groundElevation: 100 }),
      wp({ lat: 12.972, lon: 77.59, alt: 0, groundElevation: 100 }),
      wp({ lat: 12.973, lon: 77.59, alt: 0, command: 'LAND', groundElevation: 100 }),
    ];
    expect(codes(validateMission(mission, { profile: ARDUCOPTER }).errors)).not.toContain('TERRAIN_CLEARANCE');
    // PX4 flies to 0 m as written.
    expect(codes(validateMission(mission, { profile: PX4_COPTER }).errors)).toContain('TERRAIN_CLEARANCE');
  });

  it('words NO_LAND per vehicle and blocks a ground start without TAKEOFF on ArduCopter', () => {
    const open = [wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }), wp({ lat: 12.971, lon: 77.59 })];
    expect(validateMission(open, { profile: ARDUPLANE }).warnings.find((w) => w.code === 'NO_LAND')?.message)
      .toContain('switches to RTL at mission end');
    expect(validateMission(open, { profile: ARDUCOPTER }).warnings.find((w) => w.code === 'NO_LAND')?.message)
      .toContain('hovers at the last waypoint');

    const noTakeoff = [wp({ lat: 12.97, lon: 77.59, alt: 0 }), wp({ lat: 12.971, lon: 77.59, command: 'LAND' })];
    const copter = validateMission(noTakeoff, { profile: ARDUCOPTER }).errors.find((e) => e.code === 'NO_TAKEOFF');
    expect(copter?.message).toContain('ArduCopter will not start AUTO on the ground without a TAKEOFF');
    expect(codes(validateMission(noTakeoff, { profile: ARDUPLANE }).errors)).not.toContain('NO_TAKEOFF');
  });

  it('blocks a repeat of -2 or lower, which ArduPilot never takes', () => {
    const mission = simpleMission();
    mission[2] = { ...mission[2], actions: [{ id: 'j', command: 'DO_JUMP', jumpTargetId: mission[1].id, param2: -2 }] };
    const result = validateMission(mission, { profile: ARDUCOPTER });
    expect(result.errors.find((e) => e.code === 'JUMP_NEVER_TAKEN')?.message).toContain('ArduPilot never takes this jump');
    expect(codes(result.errors)).not.toContain('JUMP_LOOP_NO_EXIT');
  });

  it('warns past 15 DO_JUMPs', () => {
    const mission = longMission(16);
    for (let k = 1; k <= 16; k++) {
      mission[k] = { ...mission[k], actions: [{ id: `j${k}`, command: 'DO_JUMP', jumpTargetId: mission[k].id, param2: 1 }] };
    }
    const issue = validateMission(mission, { profile: ARDUCOPTER }).warnings.find((w) => w.code === 'JUMP_TRACKING_LIMIT');
    expect(issue?.message).toContain('Only the first 15 jumps are tracked on most boards');
    expect(issue?.waypointIndex).toBe(16);
  });

  it('flags fractional loiter turns and coarse loiter radii', () => {
    const mission = simpleMission();
    mission[1] = { ...mission[1], command: 'LOITER_TURNS', holdTime: 2.5, param2: 300 };
    const result = validateMission(mission, { profile: ARDUCOPTER });
    expect(result.warnings.find((w) => w.code === 'LOITER_TURNS_ROUNDED')?.message).toContain('rounded down to 2 turns');
    expect(result.warnings.find((w) => w.code === 'LOITER_RADIUS_COARSE')?.message).toContain('stored in 10 m steps');
  });
});

describe('validateMission — ArduPlane DO_LAND_START', () => {
  function landing(): Waypoint[] {
    return [
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: 'TAKEOFF' }),
      wp({ lat: 12.975, lon: 77.59, alt: 60 }),
      wp({ lat: 12.98, lon: 77.59, alt: 0, command: 'DO_LAND_START' }),
      wp({ lat: 12.975, lon: 77.595, alt: 30 }),
      wp({ lat: 12.97, lon: 77.59, alt: 0, command: 'LAND' }),
    ];
  }

  it('blocks the upload when the plane reports RTL_AUTOLAND = 0', () => {
    const result = validateMission(landing(), { profile: ARDUPLANE, rtlAutoland: 0 });
    const issue = result.errors.find((e) => e.code === 'LAND_START_NEEDS_AUTOLAND');
    expect(issue?.severity).toBe('blocking');
    expect(issue?.waypointIndex).toBe(2);
    expect(result.valid).toBe(false);
  });

  it('stays quiet when RTL_AUTOLAND lands through the marker, is unknown, or the vehicle is a copter', () => {
    const quiet = (options: ValidationOptions) =>
      codes(validateMission(landing(), options).errors).includes('LAND_START_NEEDS_AUTOLAND');
    expect(quiet({ profile: ARDUPLANE, rtlAutoland: 2 })).toBe(false);
    expect(quiet({ profile: ARDUPLANE })).toBe(false);
    expect(quiet({ profile: ARDUCOPTER, rtlAutoland: 0 })).toBe(false);
  });
});
