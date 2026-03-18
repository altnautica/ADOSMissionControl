import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";
import type { AttitudeData, PositionData, BatteryData, GpsData, VfrData, RcData, SysStatusData, RadioData, EkfData, VibrationData, ServoOutputData, WindData, TerrainData, LocalPositionData, DebugData, GimbalData, ObstacleData, ScaledImuData, HomePositionData, PowerStatusData, DistanceSensorData, FenceStatusData, EstimatorStatusData, CameraTriggerData, NavControllerData } from "@/lib/types";

interface TelemetryStoreState {
  _version: number;
  attitude: RingBuffer<AttitudeData>;
  position: RingBuffer<PositionData>;
  battery: RingBuffer<BatteryData>;
  gps: RingBuffer<GpsData>;
  gps2: RingBuffer<GpsData>;
  vfr: RingBuffer<VfrData>;
  rc: RingBuffer<RcData>;
  sysStatus: RingBuffer<SysStatusData>;
  radio: RingBuffer<RadioData>;
  ekf: RingBuffer<EkfData>;
  vibration: RingBuffer<VibrationData>;
  servoOutput: RingBuffer<ServoOutputData>;
  wind: RingBuffer<WindData>;
  terrain: RingBuffer<TerrainData>;
  localPosition: RingBuffer<LocalPositionData>;
  debug: RingBuffer<DebugData>;
  gimbal: RingBuffer<GimbalData>;
  obstacle: RingBuffer<ObstacleData>;
  scaledImu: RingBuffer<ScaledImuData>;
  homePosition: RingBuffer<HomePositionData>;
  powerStatus: RingBuffer<PowerStatusData>;
  distanceSensor: RingBuffer<DistanceSensorData>;
  fenceStatus: RingBuffer<FenceStatusData>;
  estimatorStatus: RingBuffer<EstimatorStatusData>;
  cameraTrigger: RingBuffer<CameraTriggerData>;
  navController: RingBuffer<NavControllerData>;

  pushAttitude: (data: AttitudeData) => void;
  pushPosition: (data: PositionData) => void;
  pushBattery: (data: BatteryData) => void;
  pushGps: (data: GpsData) => void;
  pushGps2: (data: GpsData) => void;
  pushVfr: (data: VfrData) => void;
  pushRc: (data: RcData) => void;
  pushSysStatus: (data: SysStatusData) => void;
  pushRadio: (data: RadioData) => void;
  pushEkf: (data: EkfData) => void;
  pushVibration: (data: VibrationData) => void;
  pushServoOutput: (data: ServoOutputData) => void;
  pushWind: (data: WindData) => void;
  pushTerrain: (data: TerrainData) => void;
  pushLocalPosition: (data: LocalPositionData) => void;
  pushDebug: (data: DebugData) => void;
  pushGimbal: (data: GimbalData) => void;
  pushObstacle: (data: ObstacleData) => void;
  pushScaledImu: (data: ScaledImuData) => void;
  pushHomePosition: (data: HomePositionData) => void;
  pushPowerStatus: (data: PowerStatusData) => void;
  pushDistanceSensor: (data: DistanceSensorData) => void;
  pushFenceStatus: (data: FenceStatusData) => void;
  pushEstimatorStatus: (data: EstimatorStatusData) => void;
  pushCameraTrigger: (data: CameraTriggerData) => void;
  pushNavController: (data: NavControllerData) => void;
  pushBatch: (batch: Partial<{
    attitude: AttitudeData;
    position: PositionData;
    battery: BatteryData;
    gps: GpsData;
    gps2: GpsData;
    vfr: VfrData;
    rc: RcData;
    sysStatus: SysStatusData;
    radio: RadioData;
    ekf: EkfData;
    vibration: VibrationData;
    servoOutput: ServoOutputData;
    wind: WindData;
    terrain: TerrainData;
    localPosition: LocalPositionData;
    debug: DebugData;
    gimbal: GimbalData;
    obstacle: ObstacleData;
    scaledImu: ScaledImuData;
    homePosition: HomePositionData;
    powerStatus: PowerStatusData;
    distanceSensor: DistanceSensorData;
    fenceStatus: FenceStatusData;
    estimatorStatus: EstimatorStatusData;
    cameraTrigger: CameraTriggerData;
    navController: NavControllerData;
  }>) => void;
  clear: () => void;
}

// Coalesce version bumps — at 35+ pushes/sec, batch into one Zustand set() per animation frame
let _rafScheduled = false;
function scheduleVersionBump() {
  if (_rafScheduled) return;
  _rafScheduled = true;
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      _rafScheduled = false;
      useTelemetryStore.setState((s) => ({ _version: s._version + 1 }));
    });
  } else {
    // SSR / Node fallback
    setTimeout(() => {
      _rafScheduled = false;
      useTelemetryStore.setState((s) => ({ _version: s._version + 1 }));
    }, 16);
  }
}

export const useTelemetryStore = create<TelemetryStoreState>((set, get) => ({
  _version: 0,
  attitude: new RingBuffer<AttitudeData>(600),   // 10Hz x 60s
  position: new RingBuffer<PositionData>(300),   // 5Hz x 60s
  battery: new RingBuffer<BatteryData>(120),     // 2Hz x 60s
  gps: new RingBuffer<GpsData>(300),             // 5Hz x 60s
  gps2: new RingBuffer<GpsData>(300),            // 5Hz x 60s — GPS2_RAW
  vfr: new RingBuffer<VfrData>(600),             // 10Hz x 60s
  rc: new RingBuffer<RcData>(600),               // 10Hz x 60s
  sysStatus: new RingBuffer<SysStatusData>(60),  // 1Hz x 60s
  radio: new RingBuffer<RadioData>(120),         // 2Hz x 60s
  ekf: new RingBuffer<EkfData>(60),
  vibration: new RingBuffer<VibrationData>(120),
  servoOutput: new RingBuffer<ServoOutputData>(300),
  wind: new RingBuffer<WindData>(60),
  terrain: new RingBuffer<TerrainData>(60),
  localPosition: new RingBuffer<LocalPositionData>(300),  // 5Hz x 60s
  debug: new RingBuffer<DebugData>(300),                  // variable
  gimbal: new RingBuffer<GimbalData>(60),                 // 1Hz x 60s
  obstacle: new RingBuffer<ObstacleData>(30),             // 0.5Hz x 60s
  scaledImu: new RingBuffer<ScaledImuData>(120),           // 2Hz x 60s
  homePosition: new RingBuffer<HomePositionData>(12),      // 0.2Hz x 60s
  powerStatus: new RingBuffer<PowerStatusData>(60),        // 1Hz x 60s
  distanceSensor: new RingBuffer<DistanceSensorData>(120), // 2Hz x 60s
  fenceStatus: new RingBuffer<FenceStatusData>(60),        // 1Hz x 60s
  estimatorStatus: new RingBuffer<EstimatorStatusData>(60), // 1Hz x 60s
  cameraTrigger: new RingBuffer<CameraTriggerData>(100),    // event-driven
  navController: new RingBuffer<NavControllerData>(120),   // 2Hz x 60s

  pushAttitude: (data) => { get().attitude.push(data); scheduleVersionBump(); },
  pushPosition: (data) => { get().position.push(data); scheduleVersionBump(); },
  pushBattery: (data) => { get().battery.push(data); scheduleVersionBump(); },
  pushGps: (data) => { get().gps.push(data); scheduleVersionBump(); },
  pushGps2: (data) => { get().gps2.push(data); scheduleVersionBump(); },
  pushVfr: (data) => { get().vfr.push(data); scheduleVersionBump(); },
  pushRc: (data) => { get().rc.push(data); scheduleVersionBump(); },
  pushSysStatus: (data) => { get().sysStatus.push(data); scheduleVersionBump(); },
  pushRadio: (data) => { get().radio.push(data); scheduleVersionBump(); },
  pushEkf: (data) => { get().ekf.push(data); scheduleVersionBump(); },
  pushVibration: (data) => { get().vibration.push(data); scheduleVersionBump(); },
  pushServoOutput: (data) => { get().servoOutput.push(data); scheduleVersionBump(); },
  pushWind: (data) => { get().wind.push(data); scheduleVersionBump(); },
  pushTerrain: (data) => { get().terrain.push(data); scheduleVersionBump(); },
  pushLocalPosition: (data) => { get().localPosition.push(data); scheduleVersionBump(); },
  pushDebug: (data) => { get().debug.push(data); scheduleVersionBump(); },
  pushGimbal: (data) => { get().gimbal.push(data); scheduleVersionBump(); },
  pushObstacle: (data) => { get().obstacle.push(data); scheduleVersionBump(); },
  pushScaledImu: (data) => { get().scaledImu.push(data); scheduleVersionBump(); },
  pushHomePosition: (data) => { get().homePosition.push(data); scheduleVersionBump(); },
  pushPowerStatus: (data) => { get().powerStatus.push(data); scheduleVersionBump(); },
  pushDistanceSensor: (data) => { get().distanceSensor.push(data); scheduleVersionBump(); },
  pushFenceStatus: (data) => { get().fenceStatus.push(data); scheduleVersionBump(); },
  pushEstimatorStatus: (data) => { get().estimatorStatus.push(data); scheduleVersionBump(); },
  pushCameraTrigger: (data) => { get().cameraTrigger.push(data); scheduleVersionBump(); },
  pushNavController: (data) => { get().navController.push(data); scheduleVersionBump(); },
  pushBatch: (batch) => {
    const s = get();
    if (batch.attitude) s.attitude.push(batch.attitude);
    if (batch.position) s.position.push(batch.position);
    if (batch.battery) s.battery.push(batch.battery);
    if (batch.gps) s.gps.push(batch.gps);
    if (batch.gps2) s.gps2.push(batch.gps2);
    if (batch.vfr) s.vfr.push(batch.vfr);
    if (batch.rc) s.rc.push(batch.rc);
    if (batch.sysStatus) s.sysStatus.push(batch.sysStatus);
    if (batch.radio) s.radio.push(batch.radio);
    if (batch.ekf) s.ekf.push(batch.ekf);
    if (batch.vibration) s.vibration.push(batch.vibration);
    if (batch.servoOutput) s.servoOutput.push(batch.servoOutput);
    if (batch.wind) s.wind.push(batch.wind);
    if (batch.terrain) s.terrain.push(batch.terrain);
    if (batch.localPosition) s.localPosition.push(batch.localPosition);
    if (batch.debug) s.debug.push(batch.debug);
    if (batch.gimbal) s.gimbal.push(batch.gimbal);
    if (batch.obstacle) s.obstacle.push(batch.obstacle);
    if (batch.scaledImu) s.scaledImu.push(batch.scaledImu);
    if (batch.homePosition) s.homePosition.push(batch.homePosition);
    if (batch.powerStatus) s.powerStatus.push(batch.powerStatus);
    if (batch.distanceSensor) s.distanceSensor.push(batch.distanceSensor);
    if (batch.fenceStatus) s.fenceStatus.push(batch.fenceStatus);
    if (batch.estimatorStatus) s.estimatorStatus.push(batch.estimatorStatus);
    if (batch.cameraTrigger) s.cameraTrigger.push(batch.cameraTrigger);
    if (batch.navController) s.navController.push(batch.navController);
    scheduleVersionBump();
  },
  clear: () =>
    set({
      attitude: new RingBuffer<AttitudeData>(600),
      position: new RingBuffer<PositionData>(300),
      battery: new RingBuffer<BatteryData>(120),
      gps: new RingBuffer<GpsData>(300),
      gps2: new RingBuffer<GpsData>(300),
      vfr: new RingBuffer<VfrData>(600),
      rc: new RingBuffer<RcData>(600),
      sysStatus: new RingBuffer<SysStatusData>(60),
      radio: new RingBuffer<RadioData>(120),
      ekf: new RingBuffer<EkfData>(60),
      vibration: new RingBuffer<VibrationData>(120),
      servoOutput: new RingBuffer<ServoOutputData>(300),
      wind: new RingBuffer<WindData>(60),
      terrain: new RingBuffer<TerrainData>(60),
      localPosition: new RingBuffer<LocalPositionData>(300),
      debug: new RingBuffer<DebugData>(300),
      gimbal: new RingBuffer<GimbalData>(60),
      obstacle: new RingBuffer<ObstacleData>(30),
      scaledImu: new RingBuffer<ScaledImuData>(120),
      homePosition: new RingBuffer<HomePositionData>(12),
      powerStatus: new RingBuffer<PowerStatusData>(60),
      distanceSensor: new RingBuffer<DistanceSensorData>(120),
      fenceStatus: new RingBuffer<FenceStatusData>(60),
      estimatorStatus: new RingBuffer<EstimatorStatusData>(60),
      cameraTrigger: new RingBuffer<CameraTriggerData>(100),
      navController: new RingBuffer<NavControllerData>(120),
    }),
}));
