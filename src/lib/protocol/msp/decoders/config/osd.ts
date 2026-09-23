/**
 * MSP OSD config decoder.
 *
 * @module protocol/msp/decoders/config/osd
 */

import { readU8, readU16, readU32 } from '../../msp-decode-utils';

/**
 * The general OSD settings Betaflight's MSP_SET_OSD_CONFIG address -1 block
 * writes. The firmware reads every field of that block unconditionally, so a
 * write must carry all of them, round-tripped from the last read.
 */
export interface MspOsdGeneralConfig {
  videoSystem: number;
  units: number;
  rssiAlarm: number;
  capacityWarning: number;
  altAlarm: number;
  /** Enabled-warnings bitmask (32 bits on MSP API >= 1.41, else the low 16). */
  enabledWarnings: number;
}

export interface MspOsdConfig extends MspOsdGeneralConfig {
  flags: number;
  /** OSD_ITEM_COUNT the firmware reported; `items` holds exactly this many. */
  itemCount: number;
  /** Raw element position words, indexed by the firmware's `osd_items_e`. */
  items: Array<{ position: number }>;
  /** OSD profiles the firmware supports (1 when profiles are compiled out). */
  osdProfileCount: number;
  /** Currently selected OSD profile, 1-based. */
  osdProfileIndex: number;
}

const EMPTY: MspOsdConfig = {
  flags: 0, videoSystem: 0, units: 0, rssiAlarm: 0, capacityWarning: 0, altAlarm: 0,
  enabledWarnings: 0, itemCount: 0, items: [], osdProfileCount: 1, osdProfileIndex: 1,
};

/**
 * MSP_OSD_CONFIG (84), Betaflight layout:
 *
 *   U8  flags            @0
 *   U8  videoSystem      @1
 *   U8  units            @2
 *   U8  rssiAlarm        @3
 *   U16 capAlarm         @4
 *   U8  0                @6   (was the high half of the old timer alarm)
 *   U8  OSD_ITEM_COUNT   @7
 *   U16 altAlarm         @8
 *   U16 item_pos[count]  @10
 *   U8  statCount, U8 stat[statCount]
 *   U8  timerCount, U16 timer[timerCount]
 *   U16 enabledWarnings (low 16)
 *   -- MSP API >= 1.41 --
 *   U8  warningCount, U32 enabledWarnings
 *   U8  osdProfileCount, U8 selectedOsdProfile
 *   ...
 */
export function decodeMspOsdConfig(dv: DataView): MspOsdConfig {
  if (dv.byteLength < 10) return { ...EMPTY, items: [] };

  const flags = readU8(dv, 0);
  const videoSystem = readU8(dv, 1);
  const units = readU8(dv, 2);
  const rssiAlarm = readU8(dv, 3);
  const capacityWarning = readU16(dv, 4);
  const reportedCount = readU8(dv, 7);
  const altAlarm = readU16(dv, 8);

  const items: Array<{ position: number }> = [];
  let off = 10;
  for (let i = 0; i < reportedCount && off + 1 < dv.byteLength; i++, off += 2) {
    items.push({ position: readU16(dv, off) });
  }

  let enabledWarnings = 0;
  let osdProfileCount = 1;
  let osdProfileIndex = 1;
  const has = (n: number) => off + n <= dv.byteLength;

  if (has(1)) off += 1 + readU8(dv, off); // post-flight statistics
  if (has(1)) off += 1 + 2 * readU8(dv, off); // timers
  if (has(2)) {
    enabledWarnings = readU16(dv, off);
    off += 2;
  }
  if (has(5)) {
    enabledWarnings = readU32(dv, off + 1) >>> 0;
    off += 5;
  }
  if (has(2)) {
    osdProfileCount = Math.max(1, readU8(dv, off));
    osdProfileIndex = Math.max(1, readU8(dv, off + 1));
  }

  return {
    flags, videoSystem, units, rssiAlarm, capacityWarning, altAlarm, enabledWarnings,
    itemCount: items.length, items, osdProfileCount, osdProfileIndex,
  };
}
