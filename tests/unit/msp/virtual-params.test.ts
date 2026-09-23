import { describe, it, expect } from 'vitest';
import {
  VIRTUAL_PARAMS,
  getReadCmdsForParams,
} from '@/lib/protocol/msp/virtual-params';

describe('Virtual param wire layouts', () => {
  // ── Battery config custom encode ──
  describe('battery config custom encode', () => {
    it('BF_BATT_MIN_CELL writes both legacy U8 and U16', () => {
      const def = VIRTUAL_PARAMS.get('BF_BATT_MIN_CELL')!;
      const payload = new Uint8Array(13);
      const result = def.encode(330, payload); // 330 = 3.3V * 100
      // Legacy at offset 0: Math.round(330/10) = 33
      expect(result[0]).toBe(33);
      // U16 at offset 7: 330 LE
      expect(result[7]).toBe(330 & 0xff);
      expect(result[8]).toBe((330 >> 8) & 0xff);
    });
  });

  // ── VTX band custom encode ──
  describe('VTX band custom encode', () => {
    it('BF_VTX_BAND writes to offset 7', () => {
      const def = VIRTUAL_PARAMS.get('BF_VTX_BAND')!;
      const payload = new Uint8Array(14);
      const result = def.encode(4, payload);
      expect(result[7]).toBe(4);
      // Should not write to offset 1
      expect(result[1]).toBe(0);
    });
  });

  // ── VTX frequency custom encode ──
  describe('VTX frequency custom encode', () => {
    it('BF_VTX_FREQUENCY writes both offset 0 and 9', () => {
      const def = VIRTUAL_PARAMS.get('BF_VTX_FREQUENCY')!;
      const payload = new Uint8Array(14);
      const result = def.encode(5800, payload);
      // Check offset 0 (LE)
      expect(result[0]).toBe(5800 & 0xff);
      expect(result[1]).toBe((5800 >> 8) & 0xff);
      // Check offset 9 (LE)
      expect(result[9]).toBe(5800 & 0xff);
      expect(result[10]).toBe((5800 >> 8) & 0xff);
    });
  });

  // ── getReadCmdsForParams ──
  describe('getReadCmdsForParams', () => {
    it('returns unique commands for param names', () => {
      const cmds = getReadCmdsForParams(['BF_PID_ROLL_P', 'BF_PID_PITCH_I', 'BF_RC_RATE']);
      // PID uses 112, RC_RATE uses 111
      expect(cmds).toContain(112);
      expect(cmds).toContain(111);
      expect(cmds.length).toBe(2);
    });

    it('returns empty for unknown params', () => {
      const cmds = getReadCmdsForParams(['NONEXISTENT_PARAM']);
      expect(cmds).toEqual([]);
    });

    it('deduplicates same-command params', () => {
      const cmds = getReadCmdsForParams(['BF_PID_ROLL_P', 'BF_PID_ROLL_I', 'BF_PID_ROLL_D']);
      expect(cmds.length).toBe(1);
      expect(cmds[0]).toBe(112);
    });
  });

  // ── Encoding at one offset doesn't clobber adjacent bytes ──
  describe('encoding does not clobber adjacent bytes', () => {
    it('U8 encode only changes target byte', () => {
      const def = VIRTUAL_PARAMS.get('BF_PID_ROLL_P')!;
      const payload = new Uint8Array(30).fill(0xAA);
      const result = def.encode(42, payload);
      expect(result[0]).toBe(42);
      expect(result[1]).toBe(0xAA); // adjacent byte untouched
      expect(result[2]).toBe(0xAA);
    });

    it('U16 encode only changes 2 target bytes', () => {
      const def = VIRTUAL_PARAMS.get('BF_MOTOR_MIN_THROTTLE')!;
      const payload = new Uint8Array(10).fill(0xBB);
      const result = def.encode(1070, payload);
      expect(result[0]).toBe(1070 & 0xff);
      expect(result[1]).toBe((1070 >> 8) & 0xff);
      expect(result[2]).toBe(0xBB); // next byte untouched
    });
  });
});
