/**
 * Decoded result types for iNav MSP decoders.
 *
 * @module protocol/msp/decoders/inav/types
 */

export interface INavWaypoint {
  number: number;
  action: number;
  lat: number;
  lon: number;
  altitude: number;
  p1: number;
  p2: number;
  p3: number;
  flag: number;
}

export interface INavStatus {
  cycleTime: number;
  i2cErrors: number;
  sensors: number;
  averageLoadPercent: number;
  /** Low nibble = config profile, high nibble = battery profile. */
  profiles: number;
  armingFlags: number;
}

export interface INavMisc2 {
  onTime: number;
  flyTime: number;
  lastArmTime: number;
  totalArmTime: number;
  flags: number;
}

export interface INavSafehome {
  index: number;
  enabled: boolean;
  lat: number;
  lon: number;
}

/**
 * Legacy nav config shape decoded from the 0x2100 ID.
 * This ID now collides with Custom OSD Elements in newer iNav builds.
 * Retained for backward compatibility; check INAV_MSP note above.
 */
export interface INavNavConfig {
  maxNavAltitude: number;
  maxNavSpeed: number;
  maxClimbRate: number;
  maxManualClimbRate: number;
  maxManualSpeed: number;
  landSlowdownMinAlt: number;
  landSlowdownMaxAlt: number;
  navEmergencyLandingSpeed: number;
  navMinRthDistance: number;
  navOverclimbAngle: number;
  useMidThrottleForAlthold: boolean;
  navExtraArming: number;
}

export interface INavAnalog {
  flags: number;
  /** Battery voltage in volts (divided from raw mV). */
  voltage: number;
  mAhDrawn: number;
  rssiPct: number;
  /** Current draw in amps. */
  amperage: number;
  powerMw: number;
  mWhDrawn: number;
  batteryPercent: number;
}

export interface INavMisc {
  midrc: number;
  minthrottle: number;
  maxthrottle: number;
  mincommand: number;
  failsafeThrottle: number;
  gpsProvider: number;
  gpsBaudrateIdx: number;
  gpsUbxSbas: number;
  multiwiiCurrentOutput: number;
  rssiChannel: number;
  placeholder: number;
  magDeclination: number;
  voltageScale: number;
  cellMin: number;
  cellMax: number;
  cellWarning: number;
}

/** The profiles the FC is flying, from MSP2_INAV_STATUS byte 8. */
export interface INavActiveProfiles {
  /** Control (PID and rate) profile, 0-based (low nibble). */
  controlProfile: number;
  /** Battery profile, 0-based (high nibble). */
  batteryProfile: number;
}

/**
 * MSP2_INAV_BATTERY_CONFIG. Voltage scale, voltage source and the current
 * sensor fields are board-wide; cells, cell voltages and capacities belong to
 * the active battery profile. Capacities are in the unit `capacityUnit` names
 * (0 = mAh, 1 = mWh).
 */
export interface INavBatteryConfig {
  /** vbat_scale. */
  voltageScale: number;
  voltageSource: number;
  cells: number;
  /** Cell-detect voltage (0.01 V). */
  cellDetect: number;
  /** Cell voltages (0.01 V). */
  cellMin: number;
  cellMax: number;
  cellWarning: number;
  /** Current sensor offset (mV). */
  currentOffset: number;
  /** Current sensor scale (0.1 mV/A). */
  currentScale: number;
  capacityMah: number;
  capacityWarningMah: number;
  capacityCriticalMah: number;
  capacityUnit: number;
}

export interface INavRateProfile {
  throttleMid: number;
  throttleExpo: number;
  dynamicThrottlePid: number;
  rcRateRoll: number;
  rcRatePitch: number;
  rcRateYaw: number;
  rcExpoRoll: number;
  rcExpoPitch: number;
  rcExpoYaw: number;
  rateRoll: number;
  ratePitch: number;
  rateYaw: number;
}

export interface INavAirSpeed {
  /** Air speed in cm/s. */
  airSpeedCmS: number;
}

/**
 * MSP2_INAV_MIXER. The last two bytes are the firmware's slot ceilings
 * (MAX_SUPPORTED_MOTORS / MAX_SUPPORTED_SERVOS), not the model's configured
 * motor and servo counts.
 */
export interface INavMixer {
  /** mixer_motor_direction_inverted (reverses yaw on multirotors). */
  motorDirectionInverted: boolean;
  /** motorstop_on_low. */
  motorstopOnLow: boolean;
  /** Platform type: 0=MULTIROTOR, 1=AIRPLANE, 2=TRICOPTER, 3=ROVER, 4=BOAT, 5=HELICOPTER. */
  platformType: number;
  hasFlaps: boolean;
  appliedMixerPreset: number;
  maxSupportedMotors: number;
  maxSupportedServos: number;
}

export interface INavOsdLayoutsHeader {
  layoutCount: number;
  itemCount: number;
  variant: number;
}

export interface INavOsdAlarms {
  rssi: number;              // U8,  percent
  flyMinutes: number;        // U16, minutes
  maxAltitude: number;       // U16, meters
  distance: number;          // U16, meters
  maxNegAltitude: number;    // U16
  gforce: number;            // U16, x100
  gforceAxisMin: number;     // S16, x100
  gforceAxisMax: number;     // S16, x100
  current: number;           // U8,  amps
  imuTempMin: number;        // S16, deci-Celsius
  imuTempMax: number;        // S16, deci-Celsius
  baroTempMin: number;       // S16, deci-Celsius
  baroTempMax: number;       // S16, deci-Celsius
  adsbDistanceWarning: number; // S16, meters
  adsbDistanceAlert: number;   // S16, meters
}

export interface INavOsdPreferences {
  videoSystem: number;        // U8 (0=AUTO, 1=PAL, 2=NTSC)
  mainVoltageDecimals: number;// U8 (0-1)
  ahiReverseRoll: number;     // U8 (0-1)
  crosshairsStyle: number;    // U8
  leftSidebarScroll: number;  // U8
  rightSidebarScroll: number; // U8
  sidebarScrollArrows: number;// U8
  units: number;              // U8 (0=IMPERIAL, 1=METRIC, 2=UK, 3=AVIATION)
  statsEnergyUnit: number;    // U8 (0=MAH, 1=WH)
  adsbWarningStyle: number;   // U8
}

export interface INavMcBraking {
  speedThreshold: number;
  disengageSpeed: number;
  timeout: number;
  boostFactor: number;
  boostTimeout: number;
  boostSpeedThreshold: number;
  boostDisengage: number;
  bankAngle: number;
}

export interface INavTimerOutputModeEntry {
  timerId: number;
  mode: number;
}

export interface INavOutputMappingExt2Entry {
  timerId: number;
  usageFlags: number;
  specialLabels: number;
}

export interface INavTempSensorConfigEntry {
  type: number;
  address: number[];
  alarmMin: number;
  alarmMax: number;
  label: string;
}

export interface INavServoMixerRule {
  targetChannel: number;
  inputSource: number;
  rate: number;
  speed: number;
  conditionId: number;
}

export interface INavLogicCondition {
  enabled: boolean;
  activatorId: number;
  operation: number;
  operandAType: number;
  operandAValue: number;
  operandBType: number;
  operandBValue: number;
  flags: number;
}

export interface INavLogicConditionsStatus {
  id: number;
  value: number;
}

export interface INavGvarStatus {
  /** Array of 8 live global-variable values (signed 32-bit). */
  values: number[];
}

export interface INavProgrammingPid {
  enabled: boolean;
  setpointType: number;
  setpointValue: number;
  measurementType: number;
  measurementValue: number;
  gains: { P: number; I: number; D: number; FF: number };
}

export interface INavProgrammingPidStatus {
  id: number;
  output: number;
}

export interface INavPid {
  /** Axis index: 0=ROLL, 1=PITCH, 2=YAW, 3=POS_Z, 4=POS_XY, 5=VEL_XY, 6=SURFACE, 7=LEVEL, 8=HEADING, 9=VEL_Z */
  axis: number;
  P: number;
  I: number;
  D: number;
  FF: number;
}

/** MSP2_INAV_CUSTOM_OSD_ELEMENTS: the FC's custom-element limits. */
export interface INavCustomOsdElementsInfo {
  /** Number of custom element slots. */
  maxElements: number;
  /** Text bytes carried per element. */
  textLength: number;
  /** Parts (type + value) per element. */
  partCount: number;
}

/** One typed field of a custom OSD element (a part or the visibility rule). */
export interface INavCustomOsdField {
  type: number;
  value: number;
}

/** MSP2_INAV_CUSTOM_OSD_ELEMENT: one custom element as the FC stores it. */
export interface INavCustomOsdElement {
  index: number;
  parts: INavCustomOsdField[];
  /** Visibility rule: type 0 always, 1 global variable, 2 logic condition. */
  visibility: INavCustomOsdField;
  text: string;
}

export interface INavFwApproach {
  number: number;
  approachAlt: number;
  landAlt: number;
  approachDirection: number;
  landHeading1: number;
  landHeading2: number;
  isSeaLevelRef: boolean;
}

export interface INavRateDynamics {
  sensitivityRoll: number;
  sensitivityPitch: number;
  sensitivityYaw: number;
  correctionRoll: number;
  correctionPitch: number;
  correctionYaw: number;
  weightRoll: number;
  weightPitch: number;
  weightYaw: number;
}

export interface INavEzTune {
  enabled: boolean;
  filterHz: number;
  axisRatio: number;
  response: number;
  damping: number;
  stability: number;
  aggressiveness: number;
  rate: number;
  expo: number;
  snappiness: number;
}

/** One servo slot of MSP2_INAV_SERVO_CONFIG. */
export interface INavServoConfig {
  /** Pulse width limits and centre, microseconds. */
  min: number;
  max: number;
  middle: number;
  /** Servo rate in percent, signed (-125..125). */
  rate: number;
}

export interface INavGeozone {
  number: number;
  /** 0=EXCLUSIVE, 1=INCLUSIVE */
  type: number;
  /** 0=CIRCULAR, 1=POLYGON */
  shape: number;
  minAlt: number;
  maxAlt: number;
  isSeaLevelRef: boolean;
  fenceAction: number;
  /**
   * Vertex slots the zone occupies on the FC. A polygon uses one per corner;
   * a circle always uses two (its centre, and a slot that stores the radius).
   * Zero marks an unused zone slot.
   */
  vertexCount: number;
}

export interface INavGeozoneVertex {
  geozoneId: number;
  vertexIdx: number;
  lat: number;
  lon: number;
  /** Circle radius in cm. Present only on the centre vertex of a circular zone. */
  radius?: number;
}

export interface INavAdsbVehicle {
  callsign: string;
  icao: number;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  lastSeenMs: number;
  emitterType: number;
  ttlSec: number;
}

export interface INavCommonSetting {
  /** Raw bytes. Caller interprets based on SettingInfo.type. */
  raw: Uint8Array;
}

export interface INavSettingInfo {
  /** Setting name (the response's leading null-terminated string). */
  name: string;
  pgId: number;
  /** setting_type_e: 0 UINT8,1 INT8,2 UINT16,3 INT16,4 UINT32,5 FLOAT,6 STRING. */
  type: number;
  /** setting section (bits 3-5 of the firmware's packed type). */
  section: number;
  /** setting_mode_e: bit 6 (0x40) = MODE_LOOKUP (enum/table). */
  mode: number;
  /** Min bound — signed int32. */
  min: number;
  /** Max bound — unsigned uint32. */
  max: number;
  /** Absolute setting index (used to request by index). */
  index: number;
  profileCurrent: number;
  profileCount: number;
  /** Enum value labels (index→label), present only when MODE_LOOKUP. */
  enumValues?: string[];
  /** Current value (the response's trailing value, decoded by type). */
  value?: number;
}

export interface INavPgList {
  pgIds: number[];
}

/**
 * One rule in the common motor mixer table. Each weight is a float in
 * [-2.0, 2.0]; the wire carries it as u16 (weight + 2.0) x 1000.
 */
export interface MotorMixerRule {
  throttle: number;
  roll: number;
  pitch: number;
  yaw: number;
}
