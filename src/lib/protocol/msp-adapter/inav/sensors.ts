/**
 * iNav sensor adapter functions: temperature sensor config and live
 * readings, and calibration data.
 *
 * @module protocol/msp-adapter/inav/sensors
 */

import type { MspSerialQueue } from '../../msp/msp-serial-queue'
import { MSP } from '../../msp/msp-constants'
import {
  INAV_MSP,
  decodeMspINavTempSensorConfig,
  decodeMspINavTemperatures,
  decodeMspINavCalibrationData,
  type INavTempSensorConfigEntry,
  type INavCalibrationData,
} from '../../msp/msp-decoders-inav'
import { dv } from './helpers'

export async function inavGetTempSensorConfigs(queue: MspSerialQueue | null): Promise<INavTempSensorConfigEntry[]> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_TEMP_SENSOR_CONFIG)
  return decodeMspINavTempSensorConfig(dv(frame.payload))
}

/** Live temperature per sensor slot, tenths of a degree C; null = no valid reading. */
export async function inavGetTemperatures(queue: MspSerialQueue | null): Promise<(number | null)[]> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_TEMPERATURES)
  return decodeMspINavTemperatures(dv(frame.payload))
}

export async function inavGetCalibrationData(queue: MspSerialQueue | null): Promise<INavCalibrationData> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(MSP.MSP_CALIBRATION_DATA)
  return decodeMspINavCalibrationData(dv(frame.payload))
}

// ── MC braking ───────────────────────────────────────────────

