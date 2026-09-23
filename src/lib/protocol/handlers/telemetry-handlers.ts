/**
 * Stateless telemetry message handlers.
 * Each function decodes a MAVLink payload and dispatches to subscriber callbacks.
 *
 * @module protocol/handlers/telemetry-handlers
 */

import type {
  AttitudeCallback, PositionCallback, BatteryCallback, GpsCallback,
  VfrCallback, RcCallback, SysStatusCallback, RadioCallback,
  PowerStatusCallback, ScaledImuCallback, ScaledPressureCallback,
  EstimatorStatusCallback, LocalPositionCallback,
  RawImuCallback, RcChannelsRawCallback, RcChannelsOverrideCallback,
  AltitudeCallback,
} from '../types'
import {
  decodeAttitude, decodeGlobalPositionInt, decodeBatteryStatus,
  decodeGpsRawInt, decodeVfrHud, decodeRcChannels, decodeSysStatus,
  decodeRadioStatus, decodePowerStatus, decodeScaledImu, decodeScaledPressure,
  decodeEstimatorStatus, decodeLocalPositionNed,
  decodeRawImu, decodeRcChannelsRaw, decodeRcChannelsOverride,
  decodeAltitude,
} from '../mavlink-messages'

const RAD_TO_DEG = 180 / Math.PI

export function handleAttitude(payload: DataView, callbacks: AttitudeCallback[]): void {
  const data = decodeAttitude(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      roll: data.roll * RAD_TO_DEG,
      pitch: data.pitch * RAD_TO_DEG,
      yaw: data.yaw * RAD_TO_DEG,
      rollSpeed: data.rollspeed,
      pitchSpeed: data.pitchspeed,
      yawSpeed: data.yawspeed,
    })
  }
}

export function handleGlobalPosition(payload: DataView, callbacks: PositionCallback[]): void {
  const data = decodeGlobalPositionInt(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      lat: data.lat / 1e7,
      lon: data.lon / 1e7,
      alt: data.alt / 1000,           // mm → m
      relativeAlt: data.relativeAlt / 1000,
      // UINT16_MAX = heading unknown (e.g. PX4 without a yaw estimate).
      heading: data.hdg === 0xffff ? undefined : data.hdg / 100, // cdeg → deg
      groundSpeed: Math.sqrt(data.vx * data.vx + data.vy * data.vy) / 100, // cm/s → m/s
      climbRate: -data.vz / 100,       // cm/s → m/s (NED, so negate)
    })
  }
}

/** BATTERY_STATUS.voltages: UINT16_MAX marks a cell that is not present. */
const CELL_ABSENT_MV = 0xffff
/** Largest value one voltages[] slot can carry; a pack above it spills into the next slot. */
const CELL_MAX_MV = 0xfffe

export function handleBattery(payload: DataView, callbacks: BatteryCallback[]): void {
  const data = decodeBatteryStatus(payload)
  // voltages[0..9]: UINT16_MAX = no cell. voltages_ext[0..3]: 0 = no cell.
  // Some senders zero-fill unused base slots, so 0 is never a measured cell.
  const baseCells = data.voltages.filter((v) => v !== CELL_ABSENT_MV && v > 0)
  const extCells = data.voltagesExt.filter((v) => v !== CELL_ABSENT_MV && v > 0)
  const allSlots = [...baseCells, ...extCells]
  // The pack voltage is the sum of every populated slot, whether the slots are
  // cells or a pack total split into UINT16_MAX-1 chunks.
  const totalVoltage = allSlots.reduce((sum, v) => sum + v, 0) / 1000 // mV → V
  // A monitor without per-cell sensing puts the pack total in slot 0 (and any
  // excess above 65.534 V in slot 1). Only two or more slots that are not a
  // split total are real per-cell readings.
  const perCell = allSlots.length >= 2 && allSlots[0] !== CELL_MAX_MV
  const cellVoltages = perCell ? allSlots.map((v) => v / 1000) : undefined // mV → V

  // Temperature: centi-degrees to degrees, INT16_MAX (32767) = unavailable
  const temperature = data.temperature !== 32767 && data.temperature !== 0
    ? data.temperature / 100
    : undefined

  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      id: data.id,
      voltage: totalVoltage,
      // -1 marks a quantity the monitor does not measure.
      current: data.currentBattery === -1 ? undefined : data.currentBattery / 100, // cA → A
      remaining: data.batteryRemaining,          // already %; -1 = not estimated, rendered as no-data downstream
      consumed: data.currentConsumed === -1 ? undefined : data.currentConsumed, // mAh
      temperature,
      cellVoltages,
      ...(perCell ? { cellCount: allSlots.length } : {}),
    })
  }
}

export function handleGpsRaw(payload: DataView, callbacks: GpsCallback[]): void {
  const data = decodeGpsRawInt(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      fixType: data.fixType,
      // 255 satellites / UINT16_MAX eph are the "unknown" sentinels.
      satellites: data.satellitesVisible === 255 ? undefined : data.satellitesVisible,
      hdop: data.eph === 0xffff ? undefined : data.eph / 100, // eph is HDOP ×100
      lat: data.lat / 1e7,
      lon: data.lon / 1e7,
      alt: data.alt / 1000,        // mm → m
    })
  }
}

export function handleVfrHud(payload: DataView, callbacks: VfrCallback[]): void {
  const data = decodeVfrHud(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      airspeed: data.airspeed,
      groundspeed: data.groundspeed,
      heading: data.heading,
      throttle: data.throttle,
      alt: data.alt,
      climb: data.climb,
    })
  }
}

export function handleRcChannels(payload: DataView, callbacks: RcCallback[]): void {
  const data = decodeRcChannels(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      channels: data.channels.slice(0, data.chancount),
      rssi: data.rssi,
    })
  }
}

export function handleSysStatus(payload: DataView, callbacks: SysStatusCallback[]): void {
  const data = decodeSysStatus(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      cpuLoad: data.load,
      sensorsPresent: data.onboardControlSensorsPresent,
      sensorsEnabled: data.onboardControlSensorsEnabled,
      sensorsHealthy: data.onboardControlSensorsHealth,
      voltageMv: data.voltageBattery === 0xffff ? undefined : data.voltageBattery, // UINT16_MAX = not sent
      currentCa: data.currentBattery === -1 ? undefined : data.currentBattery,     // -1 = not measured
      batteryRemaining: data.batteryRemaining,
      dropRateComm: data.dropRateComm,
      errorsComm: data.errorsComm,
    })
  }
}

export function handleRadioStatus(
  payload: DataView,
  callbacks: RadioCallback[],
  sourceSystemId: number,
): void {
  const data = decodeRadioStatus(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      rssi: data.rssi,
      remrssi: data.remrssi,
      txbuf: data.txbuf,
      noise: data.noise,
      remnoise: data.remnoise,
      rxerrors: data.rxerrors,
      fixed: data.fixed,
      sourceSystemId,
    })
  }
}

export function handlePowerStatus(payload: DataView, callbacks: PowerStatusCallback[]): void {
  const data = decodePowerStatus(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      vcc: data.vcc,     // mV
      vservo: data.vservo, // mV
      flags: data.flags,
    })
  }
}

/** `imu` is the instance the message id names: 0 SCALED_IMU, 1 SCALED_IMU2, 2 SCALED_IMU3. */
export function handleScaledImu(payload: DataView, callbacks: ScaledImuCallback[], imu: number): void {
  const data = decodeScaledImu(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      imu,
      xacc: data.xacc,
      yacc: data.yacc,
      zacc: data.zacc,
      xgyro: data.xgyro,
      ygyro: data.ygyro,
      zgyro: data.zgyro,
      xmag: data.xmag,
      ymag: data.ymag,
      zmag: data.zmag,
    })
  }
}

export function handleScaledPressure(payload: DataView, callbacks: ScaledPressureCallback[]): void {
  const data = decodeScaledPressure(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      pressAbs: data.pressAbs,
      pressDiff: data.pressDiff,
      temperature: data.temperature / 100, // cdegC → degC
    })
  }
}

export function handleLocalPosition(payload: DataView, callbacks: LocalPositionCallback[]): void {
  const data = decodeLocalPositionNed(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      x: data.x, y: data.y, z: data.z,
      vx: data.vx, vy: data.vy, vz: data.vz,
    })
  }
}

export function handleEstimatorStatus(payload: DataView, callbacks: EstimatorStatusCallback[]): void {
  const data = decodeEstimatorStatus(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      velRatio: data.velRatio,
      posHorizRatio: data.posHorizRatio,
      posVertRatio: data.posVertRatio,
      magRatio: data.magRatio,
      haglRatio: data.haglRatio,
      tasRatio: data.tasRatio,
      posHorizAccuracy: data.posHorizAccuracy,
      posVertAccuracy: data.posVertAccuracy,
      flags: data.flags,
    })
  }
}

export function handleRawImu(payload: DataView, callbacks: RawImuCallback[]): void {
  const data = decodeRawImu(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      xacc: data.xacc,
      yacc: data.yacc,
      zacc: data.zacc,
      xgyro: data.xgyro,
      ygyro: data.ygyro,
      zgyro: data.zgyro,
      xmag: data.xmag,
      ymag: data.ymag,
      zmag: data.zmag,
    })
  }
}

export function handleRcChannelsRaw(payload: DataView, callbacks: RcChannelsRawCallback[]): void {
  const data = decodeRcChannelsRaw(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      channels: [
        data.chan1Raw, data.chan2Raw, data.chan3Raw, data.chan4Raw,
        data.chan5Raw, data.chan6Raw, data.chan7Raw, data.chan8Raw,
      ],
      port: data.port,
      rssi: data.rssi,
    })
  }
}

export function handleRcChannelsOverride(payload: DataView, callbacks: RcChannelsOverrideCallback[]): void {
  const data = decodeRcChannelsOverride(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      channels: [
        data.chan1Raw, data.chan2Raw, data.chan3Raw, data.chan4Raw,
        data.chan5Raw, data.chan6Raw, data.chan7Raw, data.chan8Raw,
      ],
      targetSystem: data.targetSystem,
      targetComponent: data.targetComponent,
    })
  }
}

export function handleAltitude(payload: DataView, callbacks: AltitudeCallback[]): void {
  const data = decodeAltitude(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      altitudeMonotonic: data.altitudeMonotonic,
      altitudeAmsl: data.altitudeAmsl,
      altitudeLocal: data.altitudeLocal,
      altitudeRelative: data.altitudeRelative,
      altitudeTerrain: data.altitudeTerrain,
      bottomClearance: data.bottomClearance,
    })
  }
}
