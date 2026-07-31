/**
 * RC channel model.
 *
 * `MSP_SET_RAW_RC` writes every channel at once, so the values a caller did
 * not think about are as live as the ones it did. These tests pin the two
 * properties that keeps safe: throttle rests at idle rather than at the center
 * of the band, and an AUX channel nobody wrote rests outside every mode range
 * configured on it.
 */
import { describe, it, expect } from 'vitest';
import {
  MspRcChannels,
  bipolarToPwm,
  throttleToPwm,
  RC_MIN,
  RC_MID,
  RC_MAX,
  RC_FLOOR,
  RC_CEIL,
  RC_THROTTLE_CUT,
  CH_THROTTLE,
  FIRST_AUX_CHANNEL,
  MAX_RC_CHANNELS,
} from '@/lib/protocol/msp/msp-rc-channels';
import type { ModeRange } from '@/lib/protocol/msp/msp-mode-map';

function readU16(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function range(auxChannel: number, rangeStart: number, rangeEnd: number, boxId = 0): ModeRange {
  return { boxId, auxChannel, rangeStart, rangeEnd };
}

describe('stick scaling', () => {
  it('maps the bipolar band rail to rail and clamps past it', () => {
    expect(bipolarToPwm(-1)).toBe(RC_MIN);
    expect(bipolarToPwm(0)).toBe(RC_MID);
    expect(bipolarToPwm(1)).toBe(RC_MAX);
    expect(bipolarToPwm(0.5)).toBe(1750);
    expect(bipolarToPwm(4)).toBe(RC_MAX);
    expect(bipolarToPwm(-4)).toBe(RC_MIN);
    expect(bipolarToPwm(Number.NaN)).toBe(RC_MID);
  });

  it('maps throttle from idle, not from center', () => {
    expect(throttleToPwm(0)).toBe(RC_MIN);
    expect(throttleToPwm(0.5)).toBe(RC_MID);
    expect(throttleToPwm(1)).toBe(RC_MAX);
    expect(throttleToPwm(-3)).toBe(RC_MIN);
    expect(throttleToPwm(Number.NaN)).toBe(RC_MIN);
  });
});

describe('resting frame', () => {
  it('idles throttle and centers the other sticks', () => {
    const ch = new MspRcChannels([]);
    const p = ch.toPayload();
    expect(readU16(p, 0)).toBe(RC_MID);
    expect(readU16(p, 2)).toBe(RC_MID);
    expect(readU16(p, CH_THROTTLE * 2)).toBe(RC_MIN);
    expect(readU16(p, 6)).toBe(RC_MID);
  });

  it('rests an AUX channel below a range that starts above the low rail', () => {
    const ch = new MspRcChannels([range(0, 1300, 2100)]);
    const pwm = ch.channelValue(FIRST_AUX_CHANNEL);
    expect(pwm).toBe(RC_MIN);
    expect(ch.activatesMode(0, pwm as number)).toBe(false);
  });

  it('rests above a range that reaches down to the low rail', () => {
    // A range configured from the bottom of the band leaves nothing below it,
    // so the resting value has to come from above instead.
    const ch = new MspRcChannels([range(0, RC_FLOOR, 1600)]);
    const pwm = ch.channelValue(FIRST_AUX_CHANNEL) as number;
    expect(pwm).toBeGreaterThanOrEqual(1600);
    expect(ch.activatesMode(0, pwm)).toBe(false);
    expect(ch.unsafeAux()).toHaveLength(0);
  });

  it('threads between two ranges when both rails are taken', () => {
    const ch = new MspRcChannels([range(0, RC_FLOOR, 1300), range(1, 1700, RC_CEIL + 1)]);
    const low = ch.channelValue(FIRST_AUX_CHANNEL) as number;
    const high = ch.channelValue(FIRST_AUX_CHANNEL + 1) as number;
    expect(ch.activatesMode(0, low)).toBe(false);
    expect(ch.activatesMode(1, high)).toBe(false);
  });

  it('reports the channel instead of guessing when ranges cover the whole band', () => {
    const ch = new MspRcChannels([range(0, RC_FLOOR, RC_CEIL + 1)]);
    const unsafe = ch.unsafeAux();
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0].auxIndex).toBe(0);
    expect(unsafe[0].channel).toBe(FIRST_AUX_CHANNEL);
    expect(ch.idleValueFor(0)).toBeNull();
  });
});

describe('frame width', () => {
  it('carries eight channels when nothing needs more', () => {
    expect(new MspRcChannels([]).channelCount).toBe(8);
  });

  it('widens once to cover the highest configured AUX channel', () => {
    const ch = new MspRcChannels([range(0, 1700, 2100), range(7, 1700, 2100)]);
    expect(ch.channelCount).toBe(12);
    expect(ch.toPayload()).toHaveLength(24);
  });

  it('never widens past what the firmware accepts', () => {
    const ch = new MspRcChannels([range(30, 1700, 2100)]);
    expect(ch.channelCount).toBe(MAX_RC_CHANNELS);
  });

  it('refuses a write past the frame instead of dropping it', () => {
    const ch = new MspRcChannels([]);
    const result = ch.setAux(6, 1900); // AUX7 is channel index 10
    expect(result.ok).toBe(false);
    expect(ch.channelValue(10)).toBeUndefined();
  });
});

describe('motor cut latch', () => {
  it('cuts throttle and takes every mode off with it', () => {
    const ch = new MspRcChannels([range(0, 1700, 2100)]);
    ch.setAux(0, 1900);
    expect(ch.channelValue(FIRST_AUX_CHANNEL)).toBe(1900);

    ch.engageCut();
    expect(ch.isCut).toBe(true);
    expect(ch.channelValue(CH_THROTTLE)).toBe(RC_THROTTLE_CUT);
    expect(ch.activatesMode(0, ch.channelValue(FIRST_AUX_CHANNEL) as number)).toBe(false);
  });

  it('refuses stick and mode writes while latched', () => {
    const ch = new MspRcChannels([range(0, 1700, 2100)]);
    ch.engageCut();

    expect(ch.setSticks(0, 0, 1, 0).ok).toBe(false);
    expect(ch.channelValue(CH_THROTTLE)).toBe(RC_THROTTLE_CUT);
    expect(ch.setAux(0, 1900).ok).toBe(false);
  });

  it('accepts a write that leaves every mode off even while latched', () => {
    const ch = new MspRcChannels([range(0, 1700, 2100)]);
    ch.engageCut();
    expect(ch.setAux(0, RC_MIN).ok).toBe(true);
  });

  it('returns to idle throttle on release', () => {
    const ch = new MspRcChannels([]);
    ch.engageCut();
    ch.releaseCut();
    expect(ch.isCut).toBe(false);
    expect(ch.channelValue(CH_THROTTLE)).toBe(RC_MIN);
  });
});
