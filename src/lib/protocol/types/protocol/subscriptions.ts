/**
 * DroneProtocol telemetry subscriptions and CAN passthrough.
 *
 * @module protocol/types/protocol/subscriptions
 */

import type { CommandResult } from '../core';
import type { AttitudeCallback, PositionCallback, BatteryCallback, GpsCallback, VfrCallback, RcCallback, StatusTextCallback, EventCallback, HeartbeatCallback, ParameterCallback, SerialDataCallback, SysStatusCallback, RadioCallback, MissionProgressCallback, EkfCallback, VibrationCallback, ServoOutputCallback, WindCallback, TerrainCallback, MagCalProgressCallback, MagCalReportCallback, AccelCalPosCallback, HomePositionCallback, GpsOriginCallback, AutopilotVersionCallback, PowerStatusCallback, DistanceSensorCallback, FenceStatusCallback, NavControllerCallback, ScaledImuCallback, ScaledPressureCallback, EstimatorStatusCallback, CameraTriggerCallback, LinkStateCallback, LocalPositionCallback, DebugCallback, GimbalAttitudeCallback, ObstacleDistanceCallback, AdsbVehicleCallback, CameraImageCapturedCallback, CameraInformationCallback, ExtendedSysStateCallback, FencePointCallback, SystemTimeCallback, RawImuCallback, RcChannelsRawCallback, RcChannelsOverrideCallback, MissionItemCallback, AltitudeCallback, WindCovCallback, AisVesselCallback, GimbalManagerInfoCallback, GimbalManagerStatusCallback, CanFrameCallback, CanFdFrameCallback, OpticalFlowCallback, OpticalFlowRadCallback, OdometryCallback, VisionPositionEstimateCallback, VisionPositionDeltaCallback } from '../callbacks';

/** Telemetry subscription members of {@link DroneProtocol}. */
export interface DroneProtocolSubscriptions {
  // ── Telemetry Subscriptions ─────────────────────────────
  // Each returns an unsubscribe function.
  onAttitude(callback: AttitudeCallback): () => void;
  onPosition(callback: PositionCallback): () => void;
  onBattery(callback: BatteryCallback): () => void;
  onGps(callback: GpsCallback): () => void;
  onVfr(callback: VfrCallback): () => void;
  onRc(callback: RcCallback): () => void;
  onStatusText(callback: StatusTextCallback): () => void;
  /** PX4 structured events (MAVLink EVENT msg 410). Text is resolved from the
   * events component-metadata; firmwares without the events interface never
   * emit these. */
  onEvent(callback: EventCallback): () => void;
  onHeartbeat(callback: HeartbeatCallback): () => void;
  onParameter(callback: ParameterCallback): () => void;
  onSerialData(callback: SerialDataCallback): () => void;
  onSysStatus(callback: SysStatusCallback): () => void;
  onRadio(callback: RadioCallback): () => void;
  onMissionProgress(callback: MissionProgressCallback): () => void;
  onEkf(callback: EkfCallback): () => void;
  onVibration(callback: VibrationCallback): () => void;
  onServoOutput(callback: ServoOutputCallback): () => void;
  onWind(callback: WindCallback): () => void;
  onTerrain(callback: TerrainCallback): () => void;
  onMagCalProgress?(callback: MagCalProgressCallback): () => void;
  onMagCalReport?(callback: MagCalReportCallback): () => void;
  onAccelCalPos?(callback: AccelCalPosCallback): () => void;
  onHomePosition?(callback: HomePositionCallback): () => void;
  /** GPS_GLOBAL_ORIGIN: the EKF origin, sent when it is set and on request. */
  onGpsOrigin?(callback: GpsOriginCallback): () => void;
  onAutopilotVersion?(callback: AutopilotVersionCallback): () => void;
  onPowerStatus?(callback: PowerStatusCallback): () => void;
  onDistanceSensor?(callback: DistanceSensorCallback): () => void;
  onFenceStatus?(callback: FenceStatusCallback): () => void;
  onNavController?(callback: NavControllerCallback): () => void;
  onScaledImu?(callback: ScaledImuCallback): () => void;
  onScaledPressure?(callback: ScaledPressureCallback): () => void;
  onEstimatorStatus?(callback: EstimatorStatusCallback): () => void;
  onCameraTrigger?(callback: CameraTriggerCallback): () => void;
  onLinkLost?(callback: LinkStateCallback): () => void;
  onLinkRestored?(callback: LinkStateCallback): () => void;
  onLocalPosition?(callback: LocalPositionCallback): () => void;
  onDebug?(callback: DebugCallback): () => void;
  onGimbalAttitude?(callback: GimbalAttitudeCallback): () => void;
  onObstacleDistance?(callback: ObstacleDistanceCallback): () => void;
  /** ADS-B traffic contacts (ADSB_VEHICLE), one call per received contact. */
  onAdsbVehicle?(callback: AdsbVehicleCallback): () => void;
  onCameraImageCaptured?(callback: CameraImageCapturedCallback): () => void;
  /** A vehicle camera's advertised capabilities (CAMERA_INFORMATION), one call per message. */
  onCameraInformation?(callback: CameraInformationCallback): () => void;
  onExtendedSysState?(callback: ExtendedSysStateCallback): () => void;
  onFencePoint?(callback: FencePointCallback): () => void;
  onSystemTime?(callback: SystemTimeCallback): () => void;
  onRawImu?(callback: RawImuCallback): () => void;
  onRcChannelsRaw?(callback: RcChannelsRawCallback): () => void;
  onRcChannelsOverride?(callback: RcChannelsOverrideCallback): () => void;
  onMissionItem?(callback: MissionItemCallback): () => void;
  onAltitude?(callback: AltitudeCallback): () => void;
  onWindCov?(callback: WindCovCallback): () => void;
  onAisVessel?(callback: AisVesselCallback): () => void;
  onGimbalManagerInfo?(callback: GimbalManagerInfoCallback): () => void;
  onGimbalManagerStatus?(callback: GimbalManagerStatusCallback): () => void;
  onCanFrame?(callback: CanFrameCallback): () => void;
  onCanFdFrame?(callback: CanFdFrameCallback): () => void;

  // ── CAN passthrough ──────────────────────────────────────
  /** Enable MAVLink CAN_FORWARD on the given bus (1 or 2; 0 disables). */
  enableCanForward?(bus: number): Promise<CommandResult>;
  /** Send a raw CAN_FRAME (msg 386) on the given bus. Fire-and-forget. */
  sendCanFrame?(bus: number, id: number, data: Uint8Array): void;
  /** Send a raw CANFD_FRAME (msg 387) on the given bus. Fire-and-forget. */
  sendCanFdFrame?(bus: number, id: number, data: Uint8Array): void;
  onOpticalFlow?(callback: OpticalFlowCallback): () => void;
  onOpticalFlowRad?(callback: OpticalFlowRadCallback): () => void;
  onOdometry?(callback: OdometryCallback): () => void;
  onVisionPositionEstimate?(callback: VisionPositionEstimateCallback): () => void;
  onVisionPositionDelta?(callback: VisionPositionDeltaCallback): () => void;

}
