/**
 * MSP adapter telemetry dispatch.
 *
 * Processes MSP response payloads and fires callbacks.
 *
 * @module protocol/msp-adapter-telemetry
 */

import type { VehicleInfo } from './types'
import type { CallbackStore } from './mavlink-adapter-callbacks'
import { MSP } from './msp/msp-constants'
import { resolveActiveMode } from './msp/msp-mode-map'
import { INAV_MSP, decodeMspAdsbVehicleList, decodeMspINavAnalog } from './msp/msp-decoders-inav'
import { mspGpsFixToMavlink, mspRssiToRcChannels, mspSensorFlagsToMavlink, RC_RSSI_UNKNOWN } from './msp/msp-mavlink-semantics'
import { useTelemetryStore } from '@/stores/telemetry-store'
import { isFresh } from '@/lib/telemetry/freshness'

function u8(buf: Uint8Array, offset: number): number { return buf[offset] }
function u16(buf: Uint8Array, offset: number): number { return buf[offset] | (buf[offset + 1] << 8) }
function u32(buf: Uint8Array, offset: number): number { return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0 }
function i16(buf: Uint8Array, offset: number): number { const val = u16(buf, offset); return val >= 0x8000 ? val - 0x10000 : val }
function i32(buf: Uint8Array, offset: number): number { return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24) }

/**
 * What one MSP link carries between frames. RSSI arrives on MSP_ANALOG and the
 * channels on MSP_RC, polled at different rates; the RC sample pairs the
 * channels with the last RSSI rather than inventing one. Height above home
 * arrives on MSP_ALTITUDE and the fix on MSP_RAW_GPS; the position sample
 * pairs the fix with the last altitude estimate while it is fresh.
 */
export interface MspTelemetryState {
  /** Last MSP_ANALOG RSSI on the RC_CHANNELS scale (255 = unknown). */
  rcRssi: number
  /** Last MSP_ALTITUDE estimate (metres above the arming origin) and when it arrived. */
  relativeAlt: { altM: number; at: number } | null
}

export function createMspTelemetryState(): MspTelemetryState {
  return { rcRssi: RC_RSSI_UNKNOWN, relativeAlt: null }
}

export function dispatchMspTelemetry(
  command: number,
  payload: Uint8Array,
  cbs: CallbackStore,
  vehicleInfo: VehicleInfo | null,
  boxIds: number[],
  state: MspTelemetryState,
): void {
  const ts = Date.now()

  switch (command) {
    case MSP.MSP_ATTITUDE: {
      if (payload.length < 6) break
      const roll = i16(payload, 0) / 10
      const pitch = i16(payload, 2) / 10
      const yaw = i16(payload, 4)
      // MSP_ATTITUDE carries angles only; body rates stay absent.
      for (const cb of cbs.attitudeCallbacks) {
        cb({ roll, pitch, yaw, timestamp: ts })
      }
      break
    }

    case MSP.MSP_ANALOG: {
      // Only the RSSI is taken from here, and it rides on the next MSP_RC
      // sample. MSP_BATTERY_STATE is polled in the same group and carries the
      // pack voltage (0.01 V), current and mAh drawn; a battery sample from
      // this frame (legacy 0.1 V voltage) would alternate with it.
      if (payload.length < 7) break
      state.rcRssi = mspRssiToRcChannels(u16(payload, 3))
      break
    }

    case MSP.MSP_BATTERY_STATE: {
      // iNav's battery sample comes from MSP2_INAV_ANALOG, which carries the
      // FC's own state of charge; a second sample from here would alternate
      // with it.
      if (vehicleInfo?.firmwareType === 'inav') break
      // U8 cellCount, U16 capacity mAh, U8 voltage 0.1 V, U16 mAh drawn,
      // I16 amperage 0.01 A, U8 battery state, U16 voltage 0.01 V.
      if (payload.length < 9) break
      const volts = u8(payload, 3) / 10
      const mahDrawn = u16(payload, 4)
      const amps = i16(payload, 6) / 100
      const voltage = payload.length >= 11 ? u16(payload, 9) / 100 : volts
      // Betaflight reports no state of charge over MSP, so remaining stays
      // -1 (not reported) rather than being estimated from pack voltage.
      for (const cb of cbs.batteryCallbacks) {
        cb({ id: 0, voltage, current: amps, remaining: -1, consumed: mahDrawn, timestamp: ts })
      }
      break
    }

    case INAV_MSP.MSP2_INAV_ANALOG: {
      if (vehicleInfo?.firmwareType !== 'inav' || payload.length < 24) break
      const analog = decodeMspINavAnalog(new DataView(payload.buffer, payload.byteOffset, payload.byteLength))
      for (const cb of cbs.batteryCallbacks) {
        cb({
          id: 0,
          voltage: analog.voltage,
          current: analog.amperage,
          remaining: analog.batteryPercent ?? -1,
          consumed: analog.mAhDrawn,
          timestamp: ts,
        })
      }
      break
    }

    case MSP.MSP_STATUS_EX: {
      if (payload.length < 15) break
      const _cycleTime = u16(payload, 0)
      const i2cErrors = u16(payload, 2)
      const sensorFlags = u16(payload, 4)
      const modeFlags = u32(payload, 6)
      const cpuLoad = u16(payload, 11)
      // The box ids are firmware-specific, so the decode needs to know which
      // firmware reported them; an iNav navigation box read against the
      // Betaflight table names a manual mode for an autonomous one.
      const { mode, armed } = resolveActiveMode(modeFlags, boxIds, vehicleInfo?.firmwareType)
      if (vehicleInfo) {
        for (const cb of cbs.heartbeatCallbacks) {
          cb({ mode, armed, systemStatus: armed ? 4 : 3, vehicleInfo })
        }
      }
      // The MSP sensor word uses a different bit layout than the MAVLink
      // MAV_SYS_STATUS_SENSOR mask the sensor-health surfaces decode; translate
      // it here so the chips are labeled correctly for an MSP FC instead of
      // showing the wrong sensors.
      const mavSensors = mspSensorFlagsToMavlink(sensorFlags, vehicleInfo?.firmwareType)
      for (const cb of cbs.sysStatusCallbacks) {
        cb({
          // MSP reports average system load in whole percent; the contract is 0.1 %.
          timestamp: ts, cpuLoad: cpuLoad * 10,
          sensorsPresent: mavSensors, sensorsEnabled: mavSensors, sensorsHealthy: mavSensors,
          batteryRemaining: -1, dropRateComm: 0, errorsComm: i2cErrors,
        })
      }
      // Betaflight reports its arming-disable flags after the variable-length
      // flight-mode-flags block; surface them so BF arming blockers show up like
      // iNav's do. iNav publishes its own arming-flags word via MSP2_INAV_STATUS
      // (below), so only Betaflight is read from here.
      if (vehicleInfo?.firmwareType === 'betaflight' && payload.length >= 16) {
        const flagBytes = u8(payload, 15)
        const afterFlags = 16 + flagBytes
        if (afterFlags + 5 <= payload.length) {
          const armDisableFlags = u32(payload, afterFlags + 1)
          useTelemetryStore.getState().setArmingFlags(armDisableFlags)
        }
      }
      break
    }

    case MSP.MSP_RC: {
      const channelCount = Math.floor(payload.length / 2)
      const channels: number[] = []
      for (let i = 0; i < channelCount; i++) {
        channels.push(u16(payload, i * 2))
      }
      for (const cb of cbs.rcCallbacks) {
        cb({ channels, rssi: state.rcRssi, timestamp: ts })
      }
      break
    }

    case MSP.MSP_MOTOR: {
      const motorCount = Math.floor(payload.length / 2)
      const motors: number[] = []
      for (let i = 0; i < motorCount; i++) {
        motors.push(u16(payload, i * 2))
      }
      for (const cb of cbs.servoOutputCallbacks) {
        cb({ timestamp: ts, port: 0, servos: motors })
      }
      break
    }

    case MSP.MSP_RAW_IMU: {
      if (payload.length < 18) break
      for (const cb of cbs.rawImuCallbacks) {
        cb({
          timestamp: ts,
          xacc: i16(payload, 0), yacc: i16(payload, 2), zacc: i16(payload, 4),
          xgyro: i16(payload, 6), ygyro: i16(payload, 8), zgyro: i16(payload, 10),
          xmag: i16(payload, 12), ymag: i16(payload, 14), zmag: i16(payload, 16),
        })
      }
      break
    }

    case MSP.MSP_ALTITUDE: {
      if (payload.length < 6) break
      // Both firmwares send the estimator altitude in cm relative to the
      // arming origin (the estimate is re-zeroed on arm), and the vario in cm/s.
      const altM = i32(payload, 0) / 100
      state.relativeAlt = { altM, at: ts }
      const climbRate = i16(payload, 4) / 100
      for (const cb of cbs.altitudeCallbacks) {
        // Baro-estimated altitude only: AMSL, terrain and bottom clearance
        // are not on the wire and stay absent.
        cb({ timestamp: ts, altitudeMonotonic: altM, altitudeLocal: altM, altitudeRelative: altM })
      }
      // MSP_ALTITUDE carries altitude and vario only. Speed, heading and
      // throttle stay absent so readouts fall back to the GPS ground speed
      // and course or show no data, never a made-up zero.
      for (const cb of cbs.vfrCallbacks) {
        cb({ timestamp: ts, alt: altM, climb: climbRate })
      }
      break
    }

    case MSP.MSP_RAW_GPS: {
      if (payload.length < 16) break
      const fixType = mspGpsFixToMavlink(u8(payload, 0), vehicleInfo?.firmwareType)
      const numSat = u8(payload, 1)
      const lat = i32(payload, 2) / 1e7
      const lon = i32(payload, 6) / 1e7
      const altGps = i16(payload, 10)
      const speed = u16(payload, 12)
      const groundCourse = u16(payload, 14)
      // HDOP (fix precision) rides at the tail when the FC reports it (iNav
      // always; Betaflight 4.x+), scaled ×100. A short payload omits it, so
      // hdop stays absent rather than reading as a perfect fix.
      const hdop = payload.length >= 18 ? u16(payload, 16) / 100 : undefined
      for (const cb of cbs.gpsCallbacks) {
        cb({ timestamp: ts, fixType, satellites: numSat, hdop, lat, lon, alt: altGps })
      }
      // The GPS altitude is metres MSL, so height above home comes only from
      // a fresh MSP_ALTITUDE estimate; without one it stays absent.
      const relativeAlt = state.relativeAlt && isFresh(state.relativeAlt.at, ts)
        ? state.relativeAlt.altM
        : undefined
      for (const cb of cbs.positionCallbacks) {
        // MSP_RAW_GPS carries no vertical speed; the vario rides on MSP_ALTITUDE.
        cb({
          timestamp: ts, lat, lon, alt: altGps, relativeAlt,
          heading: groundCourse / 10, groundSpeed: speed / 100,
        })
      }
      break
    }

    case INAV_MSP.MSP2_INAV_STATUS: {
      // MSP2_INAV_STATUS layout, from iNav `fc_msp.c`
      // `mspFcProcessOutCommand` (bytes):
      //   U16 cycleTime (0), U16 i2cErrors (2), U16 sensorStatus (4),
      //   U16 averageSystemLoadPercent (6), U8 batteryProfile<<4|configProfile (8),
      //   U32 armingFlags (9), boxModeFlags (13..)
      //
      // This used to read armingFlags at 13 — which is the BOX BITMASK — and
      // then invent navState at 17 and navAction at 18, neither of which is in
      // this message at all. `PreArmPanel` therefore decoded active mode boxes
      // as arming blockers (an active box at bit 7 rendered "Failsafe system",
      // bit 8 "Not level") and the nav-state readout was fabricated.
      if (payload.length < 13) break
      useTelemetryStore.getState().setArmingFlags(u32(payload, 9))
      break
    }

    case INAV_MSP.MSP_NAV_STATUS: {
      // MSPv1 MSP_NAV_STATUS (121), from iNav `fc_msp.c`:
      //   U8 mode (0), U8 state (1), U8 activeWpAction (2),
      //   U8 activeWpNumber (3), U8 error (4), U16 headingHoldTarget (5)
      // This is the message that actually carries nav state.
      if (payload.length < 3) break
      useTelemetryStore.getState().setNavStatus(u8(payload, 0), u8(payload, 1), u8(payload, 2))
      break
    }

    case INAV_MSP.MSP2_ADSB_VEHICLE_LIST: {
      if (payload.length < 9) break
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
      const vehicles = decodeMspAdsbVehicleList(dv)
      useTelemetryStore.getState().setAdsbVehicles(vehicles)
      break
    }
  }
}
