/**
 * Debug, camera, gimbal, and obstacle message handlers.
 * Each function decodes a MAVLink payload and dispatches to subscriber callbacks.
 *
 * @module protocol/handlers/debug-handlers
 */

import type {
  DebugCallback, CameraImageCapturedCallback, CameraTriggerCallback,
  GimbalAttitudeCallback, ObstacleDistanceCallback,
  AisVesselCallback, GimbalManagerInfoCallback, GimbalManagerStatusCallback,
} from '../types'
import {
  decodeNamedValueFloat, decodeNamedValueInt, decodeDebug,
  decodeCameraImageCaptured, decodeCameraTrigger,
  decodeGimbalDeviceAttitudeStatus, decodeObstacleDistance,
  decodeAisVessel, decodeGimbalManagerInformation, decodeGimbalManagerStatus,
} from '../mavlink-messages'

export function handleNamedValueFloat(payload: DataView, callbacks: DebugCallback[]): void {
  const data = decodeNamedValueFloat(payload)
  for (const cb of callbacks) {
    cb({ timestamp: Date.now(), name: data.name, value: data.value, type: "float" })
  }
}

export function handleNamedValueInt(payload: DataView, callbacks: DebugCallback[]): void {
  const data = decodeNamedValueInt(payload)
  for (const cb of callbacks) {
    cb({ timestamp: Date.now(), name: data.name, value: data.value, type: "int" })
  }
}

export function handleDebugValue(payload: DataView, callbacks: DebugCallback[]): void {
  const data = decodeDebug(payload)
  for (const cb of callbacks) {
    cb({ timestamp: Date.now(), name: `debug[${data.ind}]`, value: data.value, type: "debug" })
  }
}

export function handleCameraTrigger(payload: DataView, callbacks: CameraTriggerCallback[]): void {
  const data = decodeCameraTrigger(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      seq: data.seq,
      lat: data.lat / 1e7,
      lon: data.lon / 1e7,
      alt: data.alt,
    })
  }
}

export function handleCameraImageCaptured(payload: DataView, callbacks: CameraImageCapturedCallback[]): void {
  const data = decodeCameraImageCaptured(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      lat: data.lat, lon: data.lon, alt: data.alt,
      imageIndex: data.imageIndex,
      cameraId: data.cameraId,
      captureResult: data.captureResult,
      fileUrl: data.fileUrl,
    })
  }
}

export function handleGimbalAttitude(payload: DataView, callbacks: GimbalAttitudeCallback[]): void {
  const data = decodeGimbalDeviceAttitudeStatus(payload)
  // Convert quaternion to Euler angles (simplified)
  const [w, x, y, z] = data.q
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))))
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
  const RAD_TO_DEG = 180 / Math.PI
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      roll: roll * RAD_TO_DEG,
      pitch: pitch * RAD_TO_DEG,
      yaw: yaw * RAD_TO_DEG,
      angularVelocityX: data.angularVelocityX,
      angularVelocityY: data.angularVelocityY,
      angularVelocityZ: data.angularVelocityZ,
    })
  }
}

export function handleObstacleDistance(payload: DataView, callbacks: ObstacleDistanceCallback[]): void {
  const data = decodeObstacleDistance(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      distances: data.distances,
      minDistance: data.minDistance,
      maxDistance: data.maxDistance,
      increment: data.increment,
      incrementF: 0,
      angleOffset: 0,
      frame: 0,
    })
  }
}

export function handleAisVessel(payload: DataView, callbacks: AisVesselCallback[]): void {
  const data = decodeAisVessel(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      MMSI: data.MMSI,
      lat: data.lat / 1e7,
      lon: data.lon / 1e7,
      COG: data.COG / 100,          // cdeg → deg
      heading: data.heading / 100,   // cdeg → deg
      velocity: data.velocity / 100, // cm/s → m/s
      turnRate: data.turnRate,
      navigationalStatus: data.navigationalStatus,
      type: data.type,
      callsign: data.callsign,
      name: data.name,
      flags: data.flags,
    })
  }
}

export function handleGimbalManagerInfo(payload: DataView, callbacks: GimbalManagerInfoCallback[]): void {
  const data = decodeGimbalManagerInformation(payload)
  const RAD_TO_DEG = 180 / Math.PI
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      capFlags: data.capFlags,
      gimbalDeviceId: data.gimbalDeviceId,
      rollMin: data.rollMin * RAD_TO_DEG,
      rollMax: data.rollMax * RAD_TO_DEG,
      pitchMin: data.pitchMin * RAD_TO_DEG,
      pitchMax: data.pitchMax * RAD_TO_DEG,
      yawMin: data.yawMin * RAD_TO_DEG,
      yawMax: data.yawMax * RAD_TO_DEG,
    })
  }
}

export function handleGimbalManagerStatus(payload: DataView, callbacks: GimbalManagerStatusCallback[]): void {
  const data = decodeGimbalManagerStatus(payload)
  for (const cb of callbacks) {
    cb({
      timestamp: Date.now(),
      flags: data.flags,
      gimbalDeviceId: data.gimbalDeviceId,
      primaryControlSysid: data.primaryControlSysid,
      primaryControlCompid: data.primaryControlCompid,
      secondaryControlSysid: data.secondaryControlSysid,
      secondaryControlCompid: data.secondaryControlCompid,
    })
  }
}
