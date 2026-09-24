/**
 * Navigation, safety, and sensor message handlers.
 * Each function decodes a MAVLink payload and dispatches to subscriber callbacks.
 *
 * @module protocol/handlers/nav-safety-handlers
 */

import type {
  EkfCallback, VibrationCallback, ServoOutputCallback,
  WindCallback, TerrainCallback, HomePositionCallback,
  DistanceSensorCallback, FenceStatusCallback, NavControllerCallback,
  FencePointCallback, MissionProgressCallback,
  WindCovCallback, MissionItemCallback, AdsbVehicleCallback,
} from '../types'
import {
  decodeEkfStatusReport, decodeVibration, decodeServoOutputRaw,
  decodeWind, decodeTerrainReport, decodeHomePosition,
  decodeDistanceSensor, decodeFenceStatus, decodeNavControllerOutput,
  decodeFencePoint, decodeMissionCurrent, decodeMissionItemReached,
  decodeWindCov, decodeMissionItem, decodeAdsbVehicle,
} from '../mavlink-messages'

export function handleEkfStatus(payload: DataView, callbacks: EkfCallback[]): void {
  const data = decodeEkfStatusReport(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      velocityVariance: data.velocityVariance,
      posHorizVariance: data.posHorizVariance,
      posVertVariance: data.posVertVariance,
      compassVariance: data.compassVariance,
      terrainAltVariance: data.terrainAltVariance,
      flags: data.flags,
    })
  }
}

export function handleVibration(payload: DataView, callbacks: VibrationCallback[]): void {
  const data = decodeVibration(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      vibrationX: data.vibrationX,
      vibrationY: data.vibrationY,
      vibrationZ: data.vibrationZ,
      clipping0: data.clipping0,
      clipping1: data.clipping1,
      clipping2: data.clipping2,
    })
  }
}

export function handleServoOutput(payload: DataView, callbacks: ServoOutputCallback[]): void {
  const data = decodeServoOutputRaw(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      port: data.port,
      servos: [data.servo1, data.servo2, data.servo3, data.servo4,
               data.servo5, data.servo6, data.servo7, data.servo8],
    })
  }
}

export function handleWind(payload: DataView, callbacks: WindCallback[]): void {
  const data = decodeWind(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      direction: data.direction,
      speed: data.speed,
      speedZ: data.speedZ,
    })
  }
}

export function handleTerrainReport(payload: DataView, callbacks: TerrainCallback[]): void {
  const data = decodeTerrainReport(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      lat: data.lat / 1e7,
      lon: data.lon / 1e7,
      terrainHeight: data.terrainHeight,
      currentHeight: data.currentHeight,
      spacing: data.spacing,
      pending: data.pending,
      loaded: data.loaded,
    })
  }
}

/** Dispatch HOME_POSITION and return the home altitude AMSL in metres. */
export function handleHomePosition(payload: DataView, callbacks: HomePositionCallback[]): number {
  const data = decodeHomePosition(payload)
  const alt = data.alt / 1000 // mm → m
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      lat: data.lat / 1e7,
      lon: data.lon / 1e7,
      alt,
    })
  }
  return alt
}

export function handleDistanceSensor(payload: DataView, callbacks: DistanceSensorCallback[]): void {
  const data = decodeDistanceSensor(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      currentDistance: data.currentDistance, // cm
      minDistance: data.minDistance,
      maxDistance: data.maxDistance,
      orientation: data.orientation,
      id: data.id,
      covariance: data.covariance,
    })
  }
}

export function handleFenceStatus(payload: DataView, callbacks: FenceStatusCallback[]): void {
  const data = decodeFenceStatus(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      breachStatus: data.breachStatus,
      breachCount: data.breachCount,
      breachType: data.breachType,
    })
  }
}

export function handleNavControllerOutput(payload: DataView, callbacks: NavControllerCallback[]): void {
  const data = decodeNavControllerOutput(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      navBearing: data.navBearing,
      targetBearing: data.targetBearing,
      wpDist: data.wpDist,
      altError: data.altError,
      xtrackError: data.xtrackError,
    })
  }
}

export function handleFencePoint(payload: DataView, callbacks: FencePointCallback[]): void {
  const data = decodeFencePoint(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      idx: data.idx, count: data.count,
      lat: data.lat, lon: data.lon,
    })
  }
}

export function handleMissionCurrent(payload: DataView, callbacks: MissionProgressCallback[]): void {
  const data = decodeMissionCurrent(payload)
  for (const cb of callbacks) {
    cb({ currentSeq: data.seq })
  }
}

export function handleMissionItemReached(payload: DataView, callbacks: MissionProgressCallback[]): void {
  const data = decodeMissionItemReached(payload)
  for (const cb of callbacks) {
    cb({ currentSeq: data.seq, reachedSeq: data.seq })
  }
}

export function handleWindCov(payload: DataView, callbacks: WindCovCallback[]): void {
  const data = decodeWindCov(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      windX: data.windX,
      windY: data.windY,
      windZ: data.windZ,
      varHoriz: data.varHoriz,
      varVert: data.varVert,
      windAlt: data.windAlt,
      horizAccuracy: data.horizAccuracy,
      vertAccuracy: data.vertAccuracy,
    })
  }
}

export function handleMissionItemLegacy(payload: DataView, callbacks: MissionItemCallback[]): void {
  const data = decodeMissionItem(payload)
  for (const cb of callbacks) {
    cb({
      seq: data.seq,
      frame: data.frame,
      command: data.command,
      current: data.current,
      autocontinue: data.autocontinue,
      param1: data.param1,
      param2: data.param2,
      param3: data.param3,
      param4: data.param4,
      x: data.x,
      y: data.y,
      z: data.z,
    })
  }
}

/** ADSB_FLAGS bits (common.xml). */
const ADSB_VALID_COORDS = 1
const ADSB_VALID_ALTITUDE = 2
const ADSB_VALID_HEADING = 4
const ADSB_VALID_VELOCITY = 8
const ADSB_VALID_CALLSIGN = 16
const ADSB_VALID_SQUAWK = 32
/** ADSB_ALTITUDE_TYPE_GEOMETRIC: altitude is GNSS, not pressure QNH. */
const ADSB_ALTITUDE_GEOMETRIC = 1

export function handleAdsbVehicle(payload: DataView, callbacks: AdsbVehicleCallback[]): void {
  const d = decodeAdsbVehicle(payload)
  // A contact without a valid position cannot be placed or ranged; delivering
  // it at 0,0 would put phantom traffic at Null Island.
  if ((d.flags & ADSB_VALID_COORDS) === 0) return
  const has = (bit: number) => (d.flags & bit) !== 0
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      icao: d.icaoAddress,
      lat: d.lat / 1e7,
      lon: d.lon / 1e7,
      altitudeM: has(ADSB_VALID_ALTITUDE) ? d.altitude / 1000 : undefined,
      altitudeGeometric: d.altitudeType === ADSB_ALTITUDE_GEOMETRIC,
      headingDeg: has(ADSB_VALID_HEADING) ? d.heading / 100 : undefined,
      groundSpeedMs: has(ADSB_VALID_VELOCITY) ? d.horVelocity / 100 : undefined,
      callsign: has(ADSB_VALID_CALLSIGN) && d.callsign !== '' ? d.callsign : undefined,
      squawk: has(ADSB_VALID_SQUAWK) ? d.squawk : undefined,
      emitterType: d.emitterType,
      tslc: d.tslc,
    })
  }
}
