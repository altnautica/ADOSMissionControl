/**
 * MAVLink adapter — callback subscription helpers.
 *
 * Provides the subscribe/unsubscribe pattern used by all on*() methods.
 * Each method pushes to the adapter's callback array and returns
 * an unsubscribe function.
 *
 * @module protocol/mavlink-adapter-callbacks
 */

import type {
  AttitudeCallback, PositionCallback, BatteryCallback, GpsCallback,
  VfrCallback, RcCallback, StatusTextCallback, HeartbeatCallback,
  ParameterCallback, SerialDataCallback,
  SysStatusCallback, RadioCallback, MissionProgressCallback,
  EkfCallback, VibrationCallback, ServoOutputCallback,
  WindCallback, TerrainCallback,
  MagCalProgressCallback, MagCalReportCallback, AccelCalPosCallback,
  HomePositionCallback, AutopilotVersionCallback,
  PowerStatusCallback, DistanceSensorCallback, FenceStatusCallback,
  NavControllerCallback, ScaledImuCallback, ScaledPressureCallback,
  EstimatorStatusCallback, CameraTriggerCallback, LinkStateCallback,
  LocalPositionCallback, DebugCallback, GimbalAttitudeCallback,
  ObstacleDistanceCallback, CameraImageCapturedCallback,
  ExtendedSysStateCallback, FencePointCallback, SystemTimeCallback,
  RawImuCallback, RcChannelsRawCallback, RcChannelsOverrideCallback,
  MissionItemCallback, AltitudeCallback, WindCovCallback,
  AisVesselCallback, GimbalManagerInfoCallback, GimbalManagerStatusCallback,
  CanFrameCallback,
} from './types'

/** All callback arrays stored by the adapter. */
export interface CallbackStore {
  attitudeCallbacks: AttitudeCallback[]
  positionCallbacks: PositionCallback[]
  batteryCallbacks: BatteryCallback[]
  gpsCallbacks: GpsCallback[]
  vfrCallbacks: VfrCallback[]
  rcCallbacks: RcCallback[]
  statusTextCallbacks: StatusTextCallback[]
  heartbeatCallbacks: HeartbeatCallback[]
  parameterCallbacks: ParameterCallback[]
  serialDataCallbacks: SerialDataCallback[]
  sysStatusCallbacks: SysStatusCallback[]
  radioCallbacks: RadioCallback[]
  missionProgressCallbacks: MissionProgressCallback[]
  ekfCallbacks: EkfCallback[]
  vibrationCallbacks: VibrationCallback[]
  servoOutputCallbacks: ServoOutputCallback[]
  windCallbacks: WindCallback[]
  terrainCallbacks: TerrainCallback[]
  magCalProgressCallbacks: MagCalProgressCallback[]
  magCalReportCallbacks: MagCalReportCallback[]
  accelCalPosCallbacks: AccelCalPosCallback[]
  homePositionCallbacks: HomePositionCallback[]
  autopilotVersionCallbacks: AutopilotVersionCallback[]
  powerStatusCallbacks: PowerStatusCallback[]
  distanceSensorCallbacks: DistanceSensorCallback[]
  fenceStatusCallbacks: FenceStatusCallback[]
  navControllerCallbacks: NavControllerCallback[]
  scaledImuCallbacks: ScaledImuCallback[]
  scaledPressureCallbacks: ScaledPressureCallback[]
  estimatorStatusCallbacks: EstimatorStatusCallback[]
  cameraTriggerCallbacks: CameraTriggerCallback[]
  linkLostCallbacks: LinkStateCallback[]
  linkRestoredCallbacks: LinkStateCallback[]
  localPositionCallbacks: LocalPositionCallback[]
  debugCallbacks: DebugCallback[]
  gimbalAttitudeCallbacks: GimbalAttitudeCallback[]
  obstacleDistanceCallbacks: ObstacleDistanceCallback[]
  cameraImageCallbacks: CameraImageCapturedCallback[]
  extendedSysStateCallbacks: ExtendedSysStateCallback[]
  fencePointCallbacks: FencePointCallback[]
  systemTimeCallbacks: SystemTimeCallback[]
  rawImuCallbacks: RawImuCallback[]
  rcChannelsRawCallbacks: RcChannelsRawCallback[]
  rcChannelsOverrideCallbacks: RcChannelsOverrideCallback[]
  missionItemCallbacks: MissionItemCallback[]
  altitudeCallbacks: AltitudeCallback[]
  windCovCallbacks: WindCovCallback[]
  aisVesselCallbacks: AisVesselCallback[]
  gimbalManagerInfoCallbacks: GimbalManagerInfoCallback[]
  gimbalManagerStatusCallbacks: GimbalManagerStatusCallback[]
  canFrameCallbacks: CanFrameCallback[]
}

/** Create a fresh empty callback store. */
export function createCallbackStore(): CallbackStore {
  return {
    attitudeCallbacks: [],
    positionCallbacks: [],
    batteryCallbacks: [],
    gpsCallbacks: [],
    vfrCallbacks: [],
    rcCallbacks: [],
    statusTextCallbacks: [],
    heartbeatCallbacks: [],
    parameterCallbacks: [],
    serialDataCallbacks: [],
    sysStatusCallbacks: [],
    radioCallbacks: [],
    missionProgressCallbacks: [],
    ekfCallbacks: [],
    vibrationCallbacks: [],
    servoOutputCallbacks: [],
    windCallbacks: [],
    terrainCallbacks: [],
    magCalProgressCallbacks: [],
    magCalReportCallbacks: [],
    accelCalPosCallbacks: [],
    homePositionCallbacks: [],
    autopilotVersionCallbacks: [],
    powerStatusCallbacks: [],
    distanceSensorCallbacks: [],
    fenceStatusCallbacks: [],
    navControllerCallbacks: [],
    scaledImuCallbacks: [],
    scaledPressureCallbacks: [],
    estimatorStatusCallbacks: [],
    cameraTriggerCallbacks: [],
    linkLostCallbacks: [],
    linkRestoredCallbacks: [],
    localPositionCallbacks: [],
    debugCallbacks: [],
    gimbalAttitudeCallbacks: [],
    obstacleDistanceCallbacks: [],
    cameraImageCallbacks: [],
    extendedSysStateCallbacks: [],
    fencePointCallbacks: [],
    systemTimeCallbacks: [],
    rawImuCallbacks: [],
    rcChannelsRawCallbacks: [],
    rcChannelsOverrideCallbacks: [],
    missionItemCallbacks: [],
    altitudeCallbacks: [],
    windCovCallbacks: [],
    aisVesselCallbacks: [],
    gimbalManagerInfoCallbacks: [],
    gimbalManagerStatusCallbacks: [],
    canFrameCallbacks: [],
  }
}

/** Subscribe to a callback array. Returns an unsubscribe function. */
function sub<T>(arr: T[], cb: T): () => void {
  arr.push(cb)
  return () => {
    const idx = arr.indexOf(cb)
    if (idx >= 0) arr.splice(idx, 1)
  }
}

/** Wire all on*() subscription methods onto the given callback store. */
export function bindCallbackMethods(cbs: CallbackStore) {
  return {
    onAttitude: (cb: AttitudeCallback) => sub(cbs.attitudeCallbacks, cb),
    onPosition: (cb: PositionCallback) => sub(cbs.positionCallbacks, cb),
    onBattery: (cb: BatteryCallback) => sub(cbs.batteryCallbacks, cb),
    onGps: (cb: GpsCallback) => sub(cbs.gpsCallbacks, cb),
    onVfr: (cb: VfrCallback) => sub(cbs.vfrCallbacks, cb),
    onRc: (cb: RcCallback) => sub(cbs.rcCallbacks, cb),
    onStatusText: (cb: StatusTextCallback) => sub(cbs.statusTextCallbacks, cb),
    onHeartbeat: (cb: HeartbeatCallback) => sub(cbs.heartbeatCallbacks, cb),
    onParameter: (cb: ParameterCallback) => sub(cbs.parameterCallbacks, cb),
    onSerialData: (cb: SerialDataCallback) => sub(cbs.serialDataCallbacks, cb),
    onSysStatus: (cb: SysStatusCallback) => sub(cbs.sysStatusCallbacks, cb),
    onRadio: (cb: RadioCallback) => sub(cbs.radioCallbacks, cb),
    onMissionProgress: (cb: MissionProgressCallback) => sub(cbs.missionProgressCallbacks, cb),
    onEkf: (cb: EkfCallback) => sub(cbs.ekfCallbacks, cb),
    onVibration: (cb: VibrationCallback) => sub(cbs.vibrationCallbacks, cb),
    onServoOutput: (cb: ServoOutputCallback) => sub(cbs.servoOutputCallbacks, cb),
    onWind: (cb: WindCallback) => sub(cbs.windCallbacks, cb),
    onTerrain: (cb: TerrainCallback) => sub(cbs.terrainCallbacks, cb),
    onMagCalProgress: (cb: MagCalProgressCallback) => sub(cbs.magCalProgressCallbacks, cb),
    onMagCalReport: (cb: MagCalReportCallback) => sub(cbs.magCalReportCallbacks, cb),
    onAccelCalPos: (cb: AccelCalPosCallback) => sub(cbs.accelCalPosCallbacks, cb),
    onHomePosition: (cb: HomePositionCallback) => sub(cbs.homePositionCallbacks, cb),
    onAutopilotVersion: (cb: AutopilotVersionCallback) => sub(cbs.autopilotVersionCallbacks, cb),
    onPowerStatus: (cb: PowerStatusCallback) => sub(cbs.powerStatusCallbacks, cb),
    onDistanceSensor: (cb: DistanceSensorCallback) => sub(cbs.distanceSensorCallbacks, cb),
    onFenceStatus: (cb: FenceStatusCallback) => sub(cbs.fenceStatusCallbacks, cb),
    onNavController: (cb: NavControllerCallback) => sub(cbs.navControllerCallbacks, cb),
    onScaledImu: (cb: ScaledImuCallback) => sub(cbs.scaledImuCallbacks, cb),
    onScaledPressure: (cb: ScaledPressureCallback) => sub(cbs.scaledPressureCallbacks, cb),
    onEstimatorStatus: (cb: EstimatorStatusCallback) => sub(cbs.estimatorStatusCallbacks, cb),
    onCameraTrigger: (cb: CameraTriggerCallback) => sub(cbs.cameraTriggerCallbacks, cb),
    onLinkLost: (cb: LinkStateCallback) => sub(cbs.linkLostCallbacks, cb),
    onLinkRestored: (cb: LinkStateCallback) => sub(cbs.linkRestoredCallbacks, cb),
    onLocalPosition: (cb: LocalPositionCallback) => sub(cbs.localPositionCallbacks, cb),
    onDebug: (cb: DebugCallback) => sub(cbs.debugCallbacks, cb),
    onGimbalAttitude: (cb: GimbalAttitudeCallback) => sub(cbs.gimbalAttitudeCallbacks, cb),
    onObstacleDistance: (cb: ObstacleDistanceCallback) => sub(cbs.obstacleDistanceCallbacks, cb),
    onCameraImageCaptured: (cb: CameraImageCapturedCallback) => sub(cbs.cameraImageCallbacks, cb),
    onExtendedSysState: (cb: ExtendedSysStateCallback) => sub(cbs.extendedSysStateCallbacks, cb),
    onFencePoint: (cb: FencePointCallback) => sub(cbs.fencePointCallbacks, cb),
    onSystemTime: (cb: SystemTimeCallback) => sub(cbs.systemTimeCallbacks, cb),
    onRawImu: (cb: RawImuCallback) => sub(cbs.rawImuCallbacks, cb),
    onRcChannelsRaw: (cb: RcChannelsRawCallback) => sub(cbs.rcChannelsRawCallbacks, cb),
    onRcChannelsOverride: (cb: RcChannelsOverrideCallback) => sub(cbs.rcChannelsOverrideCallbacks, cb),
    onMissionItem: (cb: MissionItemCallback) => sub(cbs.missionItemCallbacks, cb),
    onAltitude: (cb: AltitudeCallback) => sub(cbs.altitudeCallbacks, cb),
    onWindCov: (cb: WindCovCallback) => sub(cbs.windCovCallbacks, cb),
    onAisVessel: (cb: AisVesselCallback) => sub(cbs.aisVesselCallbacks, cb),
    onGimbalManagerInfo: (cb: GimbalManagerInfoCallback) => sub(cbs.gimbalManagerInfoCallbacks, cb),
    onGimbalManagerStatus: (cb: GimbalManagerStatusCallback) => sub(cbs.gimbalManagerStatusCallbacks, cb),
    onCanFrame: (cb: CanFrameCallback) => sub(cbs.canFrameCallbacks, cb),
  }
}
