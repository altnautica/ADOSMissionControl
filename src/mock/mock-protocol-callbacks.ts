/**
 * Callback array declarations and subscription wiring for MockProtocol.
 *
 * Extracted to keep mock-protocol.ts under 300 lines.
 * The `MockCallbackArrays` interface provides typed access to all
 * callback arrays, and `wireOnMethods` returns the on* method implementations.
 *
 * @license GPL-3.0-only
 */

import type {
  AttitudeCallback,
  PositionCallback,
  BatteryCallback,
  GpsCallback,
  VfrCallback,
  RcCallback,
  StatusTextCallback,
  HeartbeatCallback,
  ParameterCallback,
  SerialDataCallback,
  SysStatusCallback,
  RadioCallback,
  MissionProgressCallback,
  EkfCallback,
  VibrationCallback,
  ServoOutputCallback,
  WindCallback,
  TerrainCallback,
  MagCalProgressCallback,
  MagCalReportCallback,
  AccelCalPosCallback,
  HomePositionCallback,
  AutopilotVersionCallback,
  PowerStatusCallback,
  DistanceSensorCallback,
  FenceStatusCallback,
  NavControllerCallback,
  ScaledImuCallback,
  ScaledPressureCallback,
  EstimatorStatusCallback,
  CameraTriggerCallback,
  LinkStateCallback,
  LocalPositionCallback,
  DebugCallback,
  GimbalAttitudeCallback,
  ObstacleDistanceCallback,
  CameraImageCapturedCallback,
  ExtendedSysStateCallback,
  FencePointCallback,
  SystemTimeCallback,
  RawImuCallback,
  RcChannelsRawCallback,
  RcChannelsOverrideCallback,
  MissionItemCallback,
  AltitudeCallback,
  WindCovCallback,
  AisVesselCallback,
  GimbalManagerInfoCallback,
  GimbalManagerStatusCallback,
  CanFrameCallback,
} from "@/lib/protocol/types";

function sub<T>(arr: T[], cb: T): () => void {
  arr.push(cb);
  return () => {
    const idx = arr.indexOf(cb);
    if (idx >= 0) arr.splice(idx, 1);
  };
}

export interface MockCallbackArrays {
  attitudeCbs: AttitudeCallback[];
  positionCbs: PositionCallback[];
  batteryCbs: BatteryCallback[];
  gpsCbs: GpsCallback[];
  vfrCbs: VfrCallback[];
  rcCbs: RcCallback[];
  statusTextCbs: StatusTextCallback[];
  heartbeatCbs: HeartbeatCallback[];
  parameterCbs: ParameterCallback[];
  serialDataCbs: SerialDataCallback[];
  sysStatusCbs: SysStatusCallback[];
  radioCbs: RadioCallback[];
  missionProgressCbs: MissionProgressCallback[];
  ekfCbs: EkfCallback[];
  vibrationCbs: VibrationCallback[];
  servoOutputCbs: ServoOutputCallback[];
  windCbs: WindCallback[];
  terrainCbs: TerrainCallback[];
  magCalProgressCbs: MagCalProgressCallback[];
  magCalReportCbs: MagCalReportCallback[];
  accelCalPosCbs: AccelCalPosCallback[];
  homePositionCbs: HomePositionCallback[];
  autopilotVersionCbs: AutopilotVersionCallback[];
  powerStatusCbs: PowerStatusCallback[];
  distanceSensorCbs: DistanceSensorCallback[];
  fenceStatusCbs: FenceStatusCallback[];
  navControllerCbs: NavControllerCallback[];
  scaledImuCbs: ScaledImuCallback[];
  scaledPressureCbs: ScaledPressureCallback[];
  estimatorStatusCbs: EstimatorStatusCallback[];
  cameraTriggerCbs: CameraTriggerCallback[];
  linkLostCbs: LinkStateCallback[];
  linkRestoredCbs: LinkStateCallback[];
  localPositionCbs: LocalPositionCallback[];
  debugCbs: DebugCallback[];
  gimbalAttitudeCbs: GimbalAttitudeCallback[];
  obstacleDistanceCbs: ObstacleDistanceCallback[];
  cameraImageCapturedCbs: CameraImageCapturedCallback[];
  extendedSysStateCbs: ExtendedSysStateCallback[];
  fencePointCbs: FencePointCallback[];
  systemTimeCbs: SystemTimeCallback[];
  rawImuCbs: RawImuCallback[];
  rcChannelsRawCbs: RcChannelsRawCallback[];
  rcChannelsOverrideCbs: RcChannelsOverrideCallback[];
  missionItemCbs: MissionItemCallback[];
  altitudeCbs: AltitudeCallback[];
  windCovCbs: WindCovCallback[];
  aisVesselCbs: AisVesselCallback[];
  gimbalManagerInfoCbs: GimbalManagerInfoCallback[];
  gimbalManagerStatusCbs: GimbalManagerStatusCallback[];
  canFrameCbs: CanFrameCallback[];
}

export function createCallbackArrays(): MockCallbackArrays {
  return {
    attitudeCbs: [], positionCbs: [], batteryCbs: [], gpsCbs: [],
    vfrCbs: [], rcCbs: [], statusTextCbs: [], heartbeatCbs: [],
    parameterCbs: [], serialDataCbs: [], sysStatusCbs: [], radioCbs: [],
    missionProgressCbs: [], ekfCbs: [], vibrationCbs: [], servoOutputCbs: [],
    windCbs: [], terrainCbs: [], magCalProgressCbs: [], magCalReportCbs: [],
    accelCalPosCbs: [], homePositionCbs: [], autopilotVersionCbs: [],
    powerStatusCbs: [], distanceSensorCbs: [], fenceStatusCbs: [],
    navControllerCbs: [], scaledImuCbs: [], scaledPressureCbs: [],
    estimatorStatusCbs: [], cameraTriggerCbs: [], linkLostCbs: [],
    linkRestoredCbs: [], localPositionCbs: [], debugCbs: [],
    gimbalAttitudeCbs: [], obstacleDistanceCbs: [], cameraImageCapturedCbs: [],
    extendedSysStateCbs: [], fencePointCbs: [], systemTimeCbs: [],
    rawImuCbs: [], rcChannelsRawCbs: [], rcChannelsOverrideCbs: [],
    missionItemCbs: [], altitudeCbs: [], windCovCbs: [],
    aisVesselCbs: [], gimbalManagerInfoCbs: [], gimbalManagerStatusCbs: [],
    canFrameCbs: [],
  };
}

/** Bind all on* subscription methods to the given callback arrays. */
export function bindOnMethods(cbs: MockCallbackArrays) {
  return {
    onAttitude: (cb: AttitudeCallback) => sub(cbs.attitudeCbs, cb),
    onPosition: (cb: PositionCallback) => sub(cbs.positionCbs, cb),
    onBattery: (cb: BatteryCallback) => sub(cbs.batteryCbs, cb),
    onGps: (cb: GpsCallback) => sub(cbs.gpsCbs, cb),
    onVfr: (cb: VfrCallback) => sub(cbs.vfrCbs, cb),
    onRc: (cb: RcCallback) => sub(cbs.rcCbs, cb),
    onStatusText: (cb: StatusTextCallback) => sub(cbs.statusTextCbs, cb),
    onHeartbeat: (cb: HeartbeatCallback) => sub(cbs.heartbeatCbs, cb),
    onParameter: (cb: ParameterCallback) => sub(cbs.parameterCbs, cb),
    onSerialData: (cb: SerialDataCallback) => sub(cbs.serialDataCbs, cb),
    onSysStatus: (cb: SysStatusCallback) => sub(cbs.sysStatusCbs, cb),
    onRadio: (cb: RadioCallback) => sub(cbs.radioCbs, cb),
    onMissionProgress: (cb: MissionProgressCallback) => sub(cbs.missionProgressCbs, cb),
    onEkf: (cb: EkfCallback) => sub(cbs.ekfCbs, cb),
    onVibration: (cb: VibrationCallback) => sub(cbs.vibrationCbs, cb),
    onServoOutput: (cb: ServoOutputCallback) => sub(cbs.servoOutputCbs, cb),
    onWind: (cb: WindCallback) => sub(cbs.windCbs, cb),
    onTerrain: (cb: TerrainCallback) => sub(cbs.terrainCbs, cb),
    onMagCalProgress: (cb: MagCalProgressCallback) => sub(cbs.magCalProgressCbs, cb),
    onMagCalReport: (cb: MagCalReportCallback) => sub(cbs.magCalReportCbs, cb),
    onAccelCalPos: (cb: AccelCalPosCallback) => sub(cbs.accelCalPosCbs, cb),
    onHomePosition: (cb: HomePositionCallback) => sub(cbs.homePositionCbs, cb),
    onAutopilotVersion: (cb: AutopilotVersionCallback) => sub(cbs.autopilotVersionCbs, cb),
    onPowerStatus: (cb: PowerStatusCallback) => sub(cbs.powerStatusCbs, cb),
    onDistanceSensor: (cb: DistanceSensorCallback) => sub(cbs.distanceSensorCbs, cb),
    onFenceStatus: (cb: FenceStatusCallback) => sub(cbs.fenceStatusCbs, cb),
    onNavController: (cb: NavControllerCallback) => sub(cbs.navControllerCbs, cb),
    onScaledImu: (cb: ScaledImuCallback) => sub(cbs.scaledImuCbs, cb),
    onScaledPressure: (cb: ScaledPressureCallback) => sub(cbs.scaledPressureCbs, cb),
    onEstimatorStatus: (cb: EstimatorStatusCallback) => sub(cbs.estimatorStatusCbs, cb),
    onCameraTrigger: (cb: CameraTriggerCallback) => sub(cbs.cameraTriggerCbs, cb),
    onLinkLost: (cb: LinkStateCallback) => sub(cbs.linkLostCbs, cb),
    onLinkRestored: (cb: LinkStateCallback) => sub(cbs.linkRestoredCbs, cb),
    onLocalPosition: (cb: LocalPositionCallback) => sub(cbs.localPositionCbs, cb),
    onDebug: (cb: DebugCallback) => sub(cbs.debugCbs, cb),
    onGimbalAttitude: (cb: GimbalAttitudeCallback) => sub(cbs.gimbalAttitudeCbs, cb),
    onObstacleDistance: (cb: ObstacleDistanceCallback) => sub(cbs.obstacleDistanceCbs, cb),
    onCameraImageCaptured: (cb: CameraImageCapturedCallback) => sub(cbs.cameraImageCapturedCbs, cb),
    onExtendedSysState: (cb: ExtendedSysStateCallback) => sub(cbs.extendedSysStateCbs, cb),
    onFencePoint: (cb: FencePointCallback) => sub(cbs.fencePointCbs, cb),
    onSystemTime: (cb: SystemTimeCallback) => sub(cbs.systemTimeCbs, cb),
    onRawImu: (cb: RawImuCallback) => sub(cbs.rawImuCbs, cb),
    onRcChannelsRaw: (cb: RcChannelsRawCallback) => sub(cbs.rcChannelsRawCbs, cb),
    onRcChannelsOverride: (cb: RcChannelsOverrideCallback) => sub(cbs.rcChannelsOverrideCbs, cb),
    onMissionItem: (cb: MissionItemCallback) => sub(cbs.missionItemCbs, cb),
    onAltitude: (cb: AltitudeCallback) => sub(cbs.altitudeCbs, cb),
    onWindCov: (cb: WindCovCallback) => sub(cbs.windCovCbs, cb),
    onAisVessel: (cb: AisVesselCallback) => sub(cbs.aisVesselCbs, cb),
    onGimbalManagerInfo: (cb: GimbalManagerInfoCallback) => sub(cbs.gimbalManagerInfoCbs, cb),
    onGimbalManagerStatus: (cb: GimbalManagerStatusCallback) => sub(cbs.gimbalManagerStatusCbs, cb),
    onCanFrame: (cb: CanFrameCallback) => sub(cbs.canFrameCbs, cb),
  };
}
