/**
 * MSP payload encoders for OSD layout, LED strip, and VTX settings.
 *
 * @module protocol/msp/encoders/osd-led
 */

import { makeBuffer, push8, push16, push32 } from "./helpers";

/**
 * MSP_SET_OSD_CONFIG (85), element form: U8 element index (`osd_items_e`),
 * U16 position word.
 */
export function encodeMspSetOsdConfig(index: number, position: number): Uint8Array {
  if (index < 0 || index > 0xfd) throw new RangeError(`OSD element index ${index} out of range`);
  const { buf, dv } = makeBuffer(3);
  push8(dv, 0, index);
  push16(dv, 1, position);
  return buf;
}

/**
 * MSP_SET_OSD_CONFIG (85), address -1 (0xFF): the general OSD settings.
 *
 * Betaflight reads video system, units, RSSI alarm, capacity alarm, a
 * skipped U16 and the altitude alarm unconditionally, then the enabled
 * warnings as U16 (older API) and U32 (API >= 1.41). Every field is sent
 * so none is filled from stale receive-buffer bytes; the OSD profile byte
 * that may follow is deliberately left off so the active profile is kept.
 */
export function encodeMspSetOsdGeneralConfig(cfg: {
  videoSystem: number;
  units: number;
  rssiAlarm: number;
  capacityWarning: number;
  altAlarm: number;
  enabledWarnings: number;
}): Uint8Array {
  const { buf, dv } = makeBuffer(16);
  push8(dv, 0, 0xff);
  push8(dv, 1, cfg.videoSystem);
  push8(dv, 2, cfg.units);
  push8(dv, 3, cfg.rssiAlarm);
  push16(dv, 4, cfg.capacityWarning);
  push16(dv, 6, 0);
  push16(dv, 8, cfg.altAlarm);
  push16(dv, 10, cfg.enabledWarnings & 0xffff);
  push32(dv, 12, cfg.enabledWarnings >>> 0);
  return buf;
}


/**
 * MSP_OSD_CHAR_WRITE (87)
 * U16 address, then the padded 64-byte glyph character data.
 */
export function encodeMspOsdCharWrite(address: number, glyph: Uint8Array): Uint8Array {
  const { buf, dv } = makeBuffer(2 + glyph.length);
  push16(dv, 0, address);
  buf.set(glyph, 2);
  return buf;
}


/**
 * MSP_SET_LED_STRIP_CONFIG (49)
 * Writes ONE LED per call: U8 index, U32 packed config.
 */
export function encodeMspSetLedStripConfigEntry(index: number, config: number): Uint8Array {
  const { buf, dv } = makeBuffer(5);
  push8(dv, 0, index);
  push32(dv, 1, config >>> 0);
  return buf;
}

/**
 * MSP_SET_LED_STRIP_MODECOLOR (221) — set one mode colour:
 * U8 modeIndex, U8 funIndex, U8 colorIndex.
 */
export function encodeMspSetLedStripModeColor(mode: number, fun: number, color: number): Uint8Array {
  const { buf, dv } = makeBuffer(3);
  push8(dv, 0, mode & 0xff);
  push8(dv, 1, fun & 0xff);
  push8(dv, 2, color & 0xff);
  return buf;
}

/**
 * MSP_SET_LED_COLORS (47) — the full 16-entry HSV palette, 4 bytes each
 * (hue U16, saturation U8, value U8).
 */
export function encodeMspSetLedColors(colors: { h: number; s: number; v: number }[]): Uint8Array {
  const { buf, dv } = makeBuffer(colors.length * 4);
  for (let i = 0; i < colors.length; i++) {
    const off = i * 4;
    push16(dv, off, Math.max(0, Math.min(359, colors[i].h)));
    push8(dv, off + 2, Math.max(0, Math.min(255, colors[i].s)));
    push8(dv, off + 3, Math.max(0, Math.min(255, colors[i].v)));
  }
  return buf;
}


/**
 * MSP_SET_VTX_CONFIG (89) — field order:
 *   U16 frequency
 *   U8  power
 *   U8  pitMode
 *   U8  lowPowerDisarm
 *   U16 pitModeFrequency
 *   U8  band
 *   U8  channel
 *   U16 frequency (again)
 *   U8  vtxTableBands
 *   U8  vtxTableChannels
 *   U8  vtxTablePowerLevels
 *   U8  vtxTableClear
 */
export function encodeMspSetVtxConfig(config: {
  frequency: number;
  power: number;
  pitMode: boolean;
  lowPowerDisarm: number;
  pitModeFrequency: number;
  band: number;
  channel: number;
  vtxTableBands: number;
  vtxTableChannels: number;
  vtxTablePowerLevels: number;
  vtxTableClear: boolean;
}): Uint8Array {
  const { buf, dv } = makeBuffer(14);
  push16(dv, 0, config.frequency);
  push8(dv, 2, config.power);
  push8(dv, 3, config.pitMode ? 1 : 0);
  push8(dv, 4, config.lowPowerDisarm);
  push16(dv, 5, config.pitModeFrequency);
  push8(dv, 7, config.band);
  push8(dv, 8, config.channel);
  push16(dv, 9, config.frequency);
  push8(dv, 11, config.vtxTableBands);
  push8(dv, 12, config.vtxTableChannels);
  push8(dv, 13, config.vtxTablePowerLevels);
  // vtxTableClear is appended if needed
  return buf;
}

