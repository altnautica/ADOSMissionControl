/**
 * iNav battery/power decoders: analog telemetry and battery config.
 *
 * @module protocol/msp/decoders/inav/battery
 */

import { readU8, readU16, readU32 } from "./helpers";
import type { INavAnalog, INavBatteryConfig } from "./types";

// ── iNav ANALOG decoder ──────────────────────────────────────

/**
 * MSP2_INAV_ANALOG (0x2002)
 *
 * U8  flags
 * U16 voltage (mV, divide by 1000 for volts)
 * U32 mAhDrawn
 * U16 rssiPct (0-100)
 * U32 amperage (mA, divide by 1000 for amps)
 * U32 powerMw
 * U32 mWhDrawn
 * U8  batteryPercent (0-100)
 */
export function decodeMspINavAnalog(dv: DataView): INavAnalog {
  return {
    flags: readU8(dv, 0),
    voltage: (dv.byteLength > 2 ? readU16(dv, 1) : 0) / 1000,
    mAhDrawn: dv.byteLength > 6 ? readU32(dv, 3) : 0,
    rssiPct: dv.byteLength > 8 ? readU16(dv, 7) : 0,
    amperage: (dv.byteLength > 12 ? readU32(dv, 9) : 0) / 1000,
    powerMw: dv.byteLength > 16 ? readU32(dv, 13) : 0,
    mWhDrawn: dv.byteLength > 20 ? readU32(dv, 17) : 0,
    batteryPercent: dv.byteLength > 21 ? readU8(dv, 21) : 0,
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
