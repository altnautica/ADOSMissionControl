import { describe, it, expect } from 'vitest';
import {
  BOARD_PROFILES,
  detectBoardProfile,
  UNKNOWN_BOARD,
  getBoardProfileByName,
  getOutputProtocol,
} from '@/lib/board-profiles';

describe('BOARD_PROFILES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(BOARD_PROFILES)).toBe(true);
    expect(BOARD_PROFILES.length).toBeGreaterThan(0);
  });

  it('each profile has required fields (name, boardIds, timerGroups)', () => {
    for (const profile of BOARD_PROFILES) {
      expect(typeof profile.name).toBe('string');
      expect(profile.name.length).toBeGreaterThan(0);
      expect(Array.isArray(profile.boardIds)).toBe(true);
      expect(Array.isArray(profile.timerGroups)).toBe(true);
      expect(typeof profile.vendor).toBe('string');
      expect(typeof profile.outputCount).toBe('number');
    }
  });

  it('SpeedyBee F405 V3 profile exists', () => {
    const found = BOARD_PROFILES.find((p) => p.name.includes('SpeedyBee F405 V3'));
    expect(found).toBeDefined();
    expect(found!.vendor).toBe('SpeedyBee');
  });

  it('never claims one board id for two boards', () => {
    const owner = new Map<number, string>();
    for (const profile of BOARD_PROFILES) {
      for (const id of profile.boardIds) {
        expect(owner.get(id), `board id ${id}`).toBeUndefined();
        owner.set(id, profile.name);
      }
    }
  });
});

describe('detectBoardProfile', () => {
  it.each<[number, string]>([
    [1106, 'SpeedyBee F405 Wing'],
    [1082, 'SpeedyBee F405 V3'],
    [50, 'Pixhawk 4'],
    [53, 'Pixhawk 6X'],
    [1063, 'CubeOrange+'],
  ])('resolves board id %i to %s', (id, name) => {
    expect(detectBoardProfile(id).name).toBe(name);
  });

  it('does not resolve ids that belong to other boards', () => {
    // 1032 and 1045 are not SpeedyBee boards; 1054 is a Matek F405-TE.
    expect(detectBoardProfile(1032)).toBe(UNKNOWN_BOARD);
    expect(detectBoardProfile(1045)).toBe(UNKNOWN_BOARD);
    expect(detectBoardProfile(1054)).toBe(UNKNOWN_BOARD);
  });

  it('returns UNKNOWN_BOARD for an unrecognized boardId', () => {
    const profile = detectBoardProfile(99999);
    expect(profile).toBe(UNKNOWN_BOARD);
    expect(profile.name).toBe('Unknown Board');
  });
});

describe('getBoardProfileByName', () => {
  it('returns profile for a known name', () => {
    const profile = getBoardProfileByName('SpeedyBee F405 Wing');
    expect(profile.name).toBe('SpeedyBee F405 Wing');
  });

  it('returns UNKNOWN_BOARD for an unknown name', () => {
    const profile = getBoardProfileByName('NonexistentBoard');
    expect(profile).toBe(UNKNOWN_BOARD);
  });
});

describe('getOutputProtocol', () => {
  const MOTOR1 = 33;
  it.each<[number, 'DShot' | 'PWM']>([
    [0, 'PWM'],
    [3, 'PWM'],
    [4, 'DShot'],
    [7, 'DShot'],
    [8, 'PWM'],
    [9, 'PWM'],
  ])('MOT_PWM_TYPE %i drives motor outputs as %s', (motPwmType, expected) => {
    expect(getOutputProtocol(MOTOR1, motPwmType)).toBe(expected);
  });
});
