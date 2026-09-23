/**
 * iNav battery/power decoders: analog telemetry and battery config.
 *
 * @module protocol/msp/decoders/inav/battery
 */

import { readU8, readU16, readS16, readS32, readU32 } from "./helpers";
import type { INavAnalog, INavBatteryConfig } from "./types";

// ── iNav ANALOG decoder ──────────────────────────────────────

/** Byte length of MSP2_INAV_ANALOG. */
const INAV_ANALOG_SIZE = 24;

/** batteryState_e value the FC reports when no pack is connected. */
const INAV_BATTERY_NOT_PRESENT = 3;

/**
 * MSP2_INAV_ANALOG (0x2002), 24 bytes, as the FC's `fc_msp.c` writes it:
 *
 * U8  flags               @0   bit0 full-when-plugged, bit1 capacity thresholds,
 *                              bits2-3 batteryState_e, bits4-7 cell count
 * U16 voltage             @1   (0.01 V)
 * I16 amperage            @3   (0.01 A)
 * I32 power               @5   (0.01 W)
 * I32 mAhDrawn            @9
 * I32 mWhDrawn            @13
 * U32 remainingCapacity   @17  (mAh or mWh, per the battery profile unit)
 * U8  batteryPercent      @21  (the FC's own state-of-charge estimate)
 * U16 rssi                @22  (0-1023)
 *
 * The FC writes 0 % when no battery is present; that is not a reading, so
 * `batteryPercent` is null in that state.
 */
export function decodeMspINavAnalog(dv: DataView): INavAnalog {
  if (dv.byteLength < INAV_ANALOG_SIZE) {
    throw new RangeError(`Analog reply is ${dv.byteLength} bytes, expected ${INAV_ANALOG_SIZE}`);
  }
  const flags = readU8(dv, 0);
  const batteryState = (flags >> 2) & 0x03;
  return {
    flags,
    batteryState,
    cellCount: flags >> 4,
    voltage: readU16(dv, 1) / 100,
    amperage: readS16(dv, 3) / 100,
    powerW: readS32(dv, 5) / 100,
    mAhDrawn: readS32(dv, 9),
    mWhDrawn: readS32(dv, 13),
    remainingCapacity: readU32(dv, 17),
    batteryPercent: batteryState === INAV_BATTERY_NOT_PRESENT ? null : readU8(dv, 21),
    rssi: readU16(dv, 22),
  };
}

// ── iNav BATTERY CONFIG decoder ──────────────────────────────

/** Byte length of MSP2_INAV_BATTERY_CONFIG and of its SET payload. */
const INAV_BATTERY_CONFIG_SIZE = 29;

/**
 * MSP2_INAV_BATTERY_CONFIG (0x2005), 29 bytes, the same layout the FC's
 * MSP2_INAV_SET_BATTERY_CONFIG requires:
 *
 * U16 voltageScale        @0
 * U8  voltageSource       @2
 * U8  cells               @3
 * U16 cellDetect          @4   (0.01 V)
 * U16 cellMin             @6   (0.01 V)
 * U16 cellMax             @8   (0.01 V)
 * U16 cellWarning         @10  (0.01 V)
 * U16 currentOffset       @12
 * U16 currentScale        @14
 * U32 capacity            @16
 * U32 capacityWarning     @20
 * U32 capacityCritical    @24
 * U8  capacityUnit        @28  (0 = mAh, 1 = mWh)
 */
export function decodeMspINavBatteryConfig(dv: DataView): INavBatteryConfig {
  if (dv.byteLength < INAV_BATTERY_CONFIG_SIZE) {
    throw new RangeError(`Battery config reply is ${dv.byteLength} bytes, expected ${INAV_BATTERY_CONFIG_SIZE}`);
  }
  return {
    voltageScale: readU16(dv, 0),
    voltageSource: readU8(dv, 2),
    cells: readU8(dv, 3),
    cellDetect: readU16(dv, 4),
    cellMin: readU16(dv, 6),
    cellMax: readU16(dv, 8),
    cellWarning: readU16(dv, 10),
    currentOffset: readU16(dv, 12),
    currentScale: readU16(dv, 14),
    capacityMah: readU32(dv, 16),
    capacityWarningMah: readU32(dv, 20),
    capacityCriticalMah: readU32(dv, 24),
    capacityUnit: readU8(dv, 28),
  };
}
