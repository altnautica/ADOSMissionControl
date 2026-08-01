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
import { INAV_MSP, decodeMspAdsbVehicleList } from './msp/msp-decoders-inav'
import { mspSensorFlagsToMavlink } from './msp/msp-sensor-flags'
import { useTelemetryStore } from '@/stores/telemetry-store'

function u8(buf: Uint8Array, offset: number): number { return buf[offset] }
function u16(buf: Uint8Array, offset: number): number { return buf[offset] | (buf[offset + 1] << 8) }
function u32(buf: Uint8Array, offset: number): number { return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0 }
function i16(buf: Uint8Array, offset: number): number { const val = u16(buf, offset); return val >= 0x8000 ? val - 0x10000 : val }
function i32(buf: Uint8Array, offset: number): number { return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24) }

export function dispatchMspTelemetry(
  command: number,
  payload: Uint8Array,
  cbs: CallbackStore,
  vehicleInfo: VehicleInfo | null,
  boxIds: number[],
): void {
  const ts = Date.now()

  switch (command) {
    case MSP.MSP_ATTITUDE: {
      if (payload.length < 6) break
      const roll = i16(payload, 0) / 10
      const pitch = i16(payload, 2) / 10
      const yaw = i16(payload, 4)
      for (const cb of cbs.attitudeCallbacks) {
        cb({ roll, pitch, yaw, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0, timestamp: ts })
      }
      break
    }

    case MSP.MSP_ANALOG: {
      if (payload.length < 7) break
      const voltage = u8(payload, 0) / 10
      const mah = u16(payload, 1)
      const rssi = u16(payload, 3)
      const amps = i16(payload, 5) / 100
      for (const cb of cbs.batteryCallbacks) {
        cb({ voltage, current: amps, remaining: -1, consumed: mah, timestamp: ts })
      }
      for (const cb of cbs.rcCallbacks) {
        cb({ channels: [], rssi: Math.round(rssi / 1023 * 255), timestamp: ts })
      }
      break
    }

    case MSP.MSP_BATTERY_STATE: {
      if (payload.length < 9) break
      const cellCount = u8(payload, 0)
      const _capacity = u16(payload, 1)
      const volts = u8(payload, 3) / 10
      const mahDrawn = u16(payload, 4)
      const amps2 = u16(payload, 6) / 100
      const _batteryState = u8(payload, 8)
      const voltage2 = payload.length >= 11 ? u16(payload, 9) / 100 : volts
      const perCell = cellCount > 0 ? voltage2 / cellCount : voltage2
      const remaining = cellCount > 0
        ? Math.max(0, Math.min(100, Math.round((perCell - 3.3) / (4.2 - 3.3) * 100)))
        : -1
      for (const cb of cbs.batteryCallbacks) {
        cb({ voltage: voltage2, current: amps2, remaining, consumed: mahDrawn, timestamp: ts })
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
          timestamp: ts, cpuLoad: cpuLoad / 10,
          sensorsPresent: mavSensors, sensorsEnabled: mavSensors, sensorsHealthy: mavSensors,
          voltageMv: 0, currentCa: 0, batteryRemaining: -1, dropRateComm: 0, errorsComm: i2cErrors,
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
        cb({ channels, rssi: 0, timestamp: ts })
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
      const altM = i32(payload, 0) / 100
      const climbRate = i16(payload, 4) / 100
      for (const cb of cbs.altitudeCallbacks) {
        cb({
          timestamp: ts, altitudeMonotonic: altM, altitudeAmsl: 0,
          altitudeLocal: altM, altitudeRelative: altM, altitudeTerrain: 0, bottomClearance: 0,
        })
      }
      for (const cb of cbs.vfrCallbacks) {
        cb({ timestamp: ts, airspeed: 0, groundspeed: 0, heading: 0, throttle: 0, alt: altM, climb: climbRate })
      }
      break
    }

    case MSP.MSP_RAW_GPS: {
      if (payload.length < 16) break
      const fixType = u8(payload, 0)
      const numSat = u8(payload, 1)
      const lat = i32(payload, 2) / 1e7
      const lon = i32(payload, 6) / 1e7
      const altGps = i16(payload, 10)
      const speed = u16(payload, 12)
      const groundCourse = u16(payload, 14)
      // HDOP (fix precision) rides at the tail when the FC reports it (iNav
      // always; Betaflight 4.x+), scaled ×100. Read the real value instead of
      // the hard-coded 0 that read as a perfect fix; leave 0 only when the FC
      // omits the field (a short payload), never inventing a precision.
      const hdop = payload.length >= 18 ? u16(payload, 16) / 100 : 0
      for (const cb of cbs.gpsCallbacks) {
        cb({ timestamp: ts, fixType, satellites: numSat, hdop, lat, lon, alt: altGps })
      }
      for (const cb of cbs.positionCallbacks) {
        cb({
          timestamp: ts, lat, lon, alt: altGps, relativeAlt: altGps,
          heading: groundCourse / 10, groundSpeed: speed / 100, airSpeed: 0, climbRate: 0,
        })
      }
      break
    }

    case INAV_MSP.MSP2_INAV_STATUS: {
      // MSP2_INAV_STATUS layout (bytes):
      //   U16 cycleTime (0), U16 i2cErrors (2), U16 sensors (4), U32 modeFlags (6),
      //   U8 currentProfile (10), U16 cpuLoad (11), U32 armingFlags (13),
      //   U8 navState (17), U8 navAction (18)
      if (payload.length < 19) break
      const armingFlags = u32(payload, 13)
      const navState = u8(payload, 17)
      const navAction = u8(payload, 18)
      const store = useTelemetryStore.getState()
      store.setNavStatus(navState, navAction)
      store.setArmingFlags(armingFlags)
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
