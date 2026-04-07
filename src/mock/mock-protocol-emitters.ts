/**
 * Emit helper methods for MockProtocol.
 *
 * Each function fires all registered callbacks for a given telemetry type.
 * Extracted to keep mock-protocol.ts under 300 lines.
 *
 * @license GPL-3.0-only
 */

import type {
  CanFrameCallback,
  SysStatusCallback,
  RadioCallback,
  EkfCallback,
  VibrationCallback,
  ServoOutputCallback,
  WindCallback,
  TerrainCallback,
  ScaledImuCallback,
  ScaledPressureCallback,
  HomePositionCallback,
  PowerStatusCallback,
  DistanceSensorCallback,
  FenceStatusCallback,
  EstimatorStatusCallback,
  CameraTriggerCallback,
  NavControllerCallback,
  LocalPositionCallback,
  DebugCallback,
  GimbalAttitudeCallback,
  ObstacleDistanceCallback,
  CameraImageCapturedCallback,
  ExtendedSysStateCallback,
  FencePointCallback,
  SystemTimeCallback,
  AutopilotVersionCallback,
  UnifiedFlightMode,
  VehicleInfo,
  AccelCalPosition,
} from "@/lib/protocol/types";
import type { MockCallbackArrays } from "./mock-protocol-callbacks";

/** Fire statusText callbacks. */
export function emitStatusText(cbs: MockCallbackArrays, severity: number, text: string): void {
  for (const cb of cbs.statusTextCbs) cb({ severity, text });
}

/** Fire heartbeat callbacks. */
export function emitHeartbeat(cbs: MockCallbackArrays, armed: boolean, mode: UnifiedFlightMode, vehicleInfo: VehicleInfo): void {
  for (const cb of cbs.heartbeatCbs) cb({ armed, mode, systemStatus: armed ? 4 : 3, vehicleInfo });
}

/** Fire accelCalPos callbacks. */
export function emitAccelCalPos(cbs: MockCallbackArrays, position: AccelCalPosition): void {
  for (const cb of cbs.accelCalPosCbs) cb({ position });
}

// ── Generic emit helpers (one per telemetry type) ───────────

export function emitSysStatus(cbs: MockCallbackArrays, data: Parameters<SysStatusCallback>[0]): void { for (const cb of cbs.sysStatusCbs) cb(data); }
export function emitRadio(cbs: MockCallbackArrays, data: Parameters<RadioCallback>[0]): void { for (const cb of cbs.radioCbs) cb(data); }
export function emitEkf(cbs: MockCallbackArrays, data: Parameters<EkfCallback>[0]): void { for (const cb of cbs.ekfCbs) cb(data); }
export function emitVibration(cbs: MockCallbackArrays, data: Parameters<VibrationCallback>[0]): void { for (const cb of cbs.vibrationCbs) cb(data); }
export function emitServoOutput(cbs: MockCallbackArrays, data: Parameters<ServoOutputCallback>[0]): void { for (const cb of cbs.servoOutputCbs) cb(data); }
export function emitWind(cbs: MockCallbackArrays, data: Parameters<WindCallback>[0]): void { for (const cb of cbs.windCbs) cb(data); }
export function emitTerrain(cbs: MockCallbackArrays, data: Parameters<TerrainCallback>[0]): void { for (const cb of cbs.terrainCbs) cb(data); }
export function emitScaledImu(cbs: MockCallbackArrays, data: Parameters<ScaledImuCallback>[0]): void { for (const cb of cbs.scaledImuCbs) cb(data); }
export function emitScaledPressure(cbs: MockCallbackArrays, data: Parameters<ScaledPressureCallback>[0]): void { for (const cb of cbs.scaledPressureCbs) cb(data); }
export function emitHomePosition(cbs: MockCallbackArrays, data: Parameters<HomePositionCallback>[0]): void { for (const cb of cbs.homePositionCbs) cb(data); }
export function emitPowerStatus(cbs: MockCallbackArrays, data: Parameters<PowerStatusCallback>[0]): void { for (const cb of cbs.powerStatusCbs) cb(data); }
export function emitDistanceSensor(cbs: MockCallbackArrays, data: Parameters<DistanceSensorCallback>[0]): void { for (const cb of cbs.distanceSensorCbs) cb(data); }
export function emitFenceStatus(cbs: MockCallbackArrays, data: Parameters<FenceStatusCallback>[0]): void { for (const cb of cbs.fenceStatusCbs) cb(data); }
export function emitEstimatorStatus(cbs: MockCallbackArrays, data: Parameters<EstimatorStatusCallback>[0]): void { for (const cb of cbs.estimatorStatusCbs) cb(data); }
export function emitCameraTrigger(cbs: MockCallbackArrays, data: Parameters<CameraTriggerCallback>[0]): void { for (const cb of cbs.cameraTriggerCbs) cb(data); }
export function emitNavController(cbs: MockCallbackArrays, data: Parameters<NavControllerCallback>[0]): void { for (const cb of cbs.navControllerCbs) cb(data); }
export function emitLocalPosition(cbs: MockCallbackArrays, data: Parameters<LocalPositionCallback>[0]): void { for (const cb of cbs.localPositionCbs) cb(data); }
export function emitDebug(cbs: MockCallbackArrays, data: Parameters<DebugCallback>[0]): void { for (const cb of cbs.debugCbs) cb(data); }
export function emitGimbalAttitude(cbs: MockCallbackArrays, data: Parameters<GimbalAttitudeCallback>[0]): void { for (const cb of cbs.gimbalAttitudeCbs) cb(data); }
export function emitObstacleDistance(cbs: MockCallbackArrays, data: Parameters<ObstacleDistanceCallback>[0]): void { for (const cb of cbs.obstacleDistanceCbs) cb(data); }
export function emitCameraImageCaptured(cbs: MockCallbackArrays, data: Parameters<CameraImageCapturedCallback>[0]): void { for (const cb of cbs.cameraImageCapturedCbs) cb(data); }
export function emitExtendedSysState(cbs: MockCallbackArrays, data: Parameters<ExtendedSysStateCallback>[0]): void { for (const cb of cbs.extendedSysStateCbs) cb(data); }
export function emitFencePoint(cbs: MockCallbackArrays, data: Parameters<FencePointCallback>[0]): void { for (const cb of cbs.fencePointCbs) cb(data); }
export function emitSystemTime(cbs: MockCallbackArrays, data: Parameters<SystemTimeCallback>[0]): void { for (const cb of cbs.systemTimeCbs) cb(data); }
export function emitAutopilotVersion(cbs: MockCallbackArrays, data: Parameters<AutopilotVersionCallback>[0]): void { for (const cb of cbs.autopilotVersionCbs) cb(data); }
export function emitCanFrame(cbs: MockCallbackArrays, data: Parameters<CanFrameCallback>[0]): void { for (const cb of cbs.canFrameCbs) cb(data); }
