/**
 * iNav battery config encoder.
 *
 * @module protocol/msp/encoders/inav/battery
 */

import type { INavBatteryConfig } from '../../msp-decoders-inav';
import { writeU8, writeU16, writeU32 } from './_helpers';

/**
 * Encode MSP2_INAV_SET_BATTERY_CONFIG (0x2006) payload. The FC accepts only a
 * 29-byte frame, laid out exactly like the MSP2_INAV_BATTERY_CONFIG reply:
 *
 * U16 voltageScale, U8 voltageSource, U8 cells, U16 cellDetect,
 * U16 cellMin, U16 cellMax, U16 cellWarning, U16 currentOffset,
 * U16 currentScale, U32 capacity, U32 capacityWarning,
 * U32 capacityCritical, U8 capacityUnit
 */
export function encodeMspINavSetBatteryConfig(cfg: INavBatteryConfig): Uint8Array {
  const buf = new Uint8Array(29);
  const dv = new DataView(buf.buffer);

  writeU16(dv, 0, cfg.voltageScale);
  writeU8(dv, 2, cfg.voltageSource);
  writeU8(dv, 3, cfg.cells);
  writeU16(dv, 4, cfg.cellDetect);
  writeU16(dv, 6, cfg.cellMin);
  writeU16(dv, 8, cfg.cellMax);
  writeU16(dv, 10, cfg.cellWarning);
  writeU16(dv, 12, cfg.currentOffset);
  writeU16(dv, 14, cfg.currentScale);
  writeU32(dv, 16, cfg.capacityMah);
  writeU32(dv, 20, cfg.capacityWarningMah);
  writeU32(dv, 24, cfg.capacityCriticalMah);
  writeU8(dv, 28, cfg.capacityUnit);

  return buf;
}
