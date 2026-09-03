// Exempt from 300 LOC soft rule: mock fixture data + protocol stub, splitting hurts readability
/**
 * INavMockProtocol : DroneProtocol implementation for iNav demo mode.
 *
 * Simulates an iNav flight controller over MSP, with in-memory state for
 * settings, waypoint missions, safehomes, and geozones. Telemetry fires at
 * 10 Hz via setInterval.
 *
 * @license GPL-3.0-only
 */

import type {
  DroneProtocol, Transport, VehicleInfo, CommandResult, ParameterValue,
  ProtocolCapabilities, FirmwareHandler, MissionItem, UnifiedFlightMode,
  LogEntry, LogDownloadProgressCallback, SettingsCapability,
  AttitudeCallback, PositionCallback, BatteryCallback, GpsCallback,
  VfrCallback, RcCallback, StatusTextCallback, EventCallback, HeartbeatCallback,
  ParameterCallback, SerialDataCallback, SysStatusCallback, RadioCallback,
  MissionProgressCallback, EkfCallback, VibrationCallback, ServoOutputCallback,
  WindCallback, TerrainCallback, MagCalProgressCallback, MagCalReportCallback,
  AccelCalPosCallback, HomePositionCallback, AutopilotVersionCallback,
  PowerStatusCallback, DistanceSensorCallback, FenceStatusCallback,
  NavControllerCallback, ScaledImuCallback, ScaledPressureCallback,
  EstimatorStatusCallback, CameraTriggerCallback, LinkStateCallback,
  LocalPositionCallback, DebugCallback, GimbalAttitudeCallback,
  ObstacleDistanceCallback, CameraImageCapturedCallback, ExtendedSysStateCallback,
  FencePointCallback, SystemTimeCallback, RawImuCallback, RcChannelsRawCallback,
  RcChannelsOverrideCallback, MissionItemCallback, AltitudeCallback,
  WindCovCallback, AisVesselCallback, GimbalManagerInfoCallback,
  GimbalManagerStatusCallback, CanFrameCallback,
  OpticalFlowCallback, OpticalFlowRadCallback, OdometryCallback,
  VisionPositionEstimateCallback, VisionPositionDeltaCallback,
  MspSerialPort, MspOsdConfig, HsvColor, BfLedModeColor,
} from "@/lib/protocol/types";
import { inavHandler } from "@/lib/protocol/firmware/inav";
import { INAV_WP_FLAG_LAST, INAV_WP_ACTION } from "@/lib/protocol/msp/msp-decoders-inav";
import type {
  INavWaypoint, INavSafehome, MotorMixerRule, INavServoMixerRule,
  INavEzTune, INavOsdAlarms, INavOsdPreferences, INavOsdLayoutsHeader,
  INavBatteryConfig, INavMixer, INavServoConfig, INavMcBraking, INavGvarStatus,
  INavTimerOutputModeEntry, INavOutputMappingExt2Entry, INavTempSensorConfigEntry,
} from "@/lib/protocol/msp/msp-decoders-inav";
import type { SettingValue, SettingInfo } from "@/lib/protocol/msp/settings";
import { SettingType } from "@/lib/protocol/msp/settings";
import { createCallbackArrays } from "./mock-protocol-callbacks";
import type { MockCallbackArrays } from "./mock-protocol-callbacks";
import type { ManualControlSample, PositionTargetSample, AttitudeTargetSample } from "./mock-control-samples";
import { useTelemetryStore } from "@/stores/telemetry-store";

// ── Helpers ───────────────────────────────────────────────────

function ok(message = "OK"): CommandResult { return { success: true, resultCode: 0, message }; }

/** The refusals the real iNav adapter gives, so demo shows the same answer. */
const INAV_NO_LAND: CommandResult = {
  success: false, resultCode: -1,
  message: 'Land is not available: iNav has no separate landing mode. Use return to home, which lands at the home point.',
};
const INAV_NO_GOTO: CommandResult = {
  success: false, resultCode: -1,
  message: 'Fly-to is not available: iNav takes a target position as an uploaded waypoint mission, not as a single command.',
};
function sub<T>(arr: T[], cb: T): () => void {
  arr.push(cb);
  return () => { const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); };
}

/** Map a stored setting entry to a typed SettingValue (mirrors the real decode). */
function settingEntryToValue(entry: SettingEntry): SettingValue {
  const v = entry.value;
  switch (entry.type) {
    case SettingType.UINT8:  return { type: "uint8",  value: Number(v) };
    case SettingType.INT8:   return { type: "int8",   value: Number(v) };
    case SettingType.UINT16: return { type: "uint16", value: Number(v) };
    case SettingType.INT16:  return { type: "int16",  value: Number(v) };
    case SettingType.UINT32: return { type: "uint32", value: Number(v) };
    case SettingType.FLOAT:  return { type: "float",  value: Number(v) };
    case SettingType.STRING: return { type: "string", value: String(v) };
    default:                 return { type: "raw",    value: new Uint8Array([Number(v) & 0xff]) };
  }
}

// ── iNav-only types ───────────────────────────────────────────

/** Geozone types supported in demo state. */
export const GEOZONE_TYPE_EXCLUSIVE = 0;
export const GEOZONE_TYPE_INCLUSIVE = 1;
export const GEOZONE_SHAPE_POLYGON = 0;
export const GEOZONE_SHAPE_CIRCULAR = 1;

export interface INavGeozone {
  index: number;
  enabled: boolean;
  shape: number;
  type: number;
  minAltitude: number;
  maxAltitude: number;
  /** Circular only: center lat (WGS84 degrees). */
  lat?: number;
  /** Circular only: center lon (WGS84 degrees). */
  lon?: number;
  /** Circular only: radius in cm. */
  radius?: number;
  /** Polygon only: vertex array [{lat, lon}] in degrees. */
  vertices?: Array<{ lat: number; lon: number }>;
}

/** Named setting entry stored in the in-memory map. */
interface SettingEntry {
  type: number;
  value: number | string;
}

/** Last DShot special command handed to the mock, for tests and debug panels. */
export interface INavMockDshotCommand {
  commandType: number;
  motorIndex: number;
  commands: number[];
}

// ── Vehicle info constants ────────────────────────────────────

const INAV_QUAD_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "inav", vehicleClass: "copter",
  firmwareVersionString: "INAV 7.1.2 (MSP API 2.5)",
  systemId: 1, componentId: 1, autopilotType: 0, vehicleType: 0,
};

const INAV_PLANE_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "inav", vehicleClass: "plane",
  firmwareVersionString: "INAV 7.1.2 (MSP API 2.5)",
  systemId: 1, componentId: 1, autopilotType: 0, vehicleType: 0,
};

// ── Config interface ──────────────────────────────────────────

export interface INavMockConfig {
  vehicleClass: "copter" | "plane";
  missionWaypoints?: INavWaypoint[];
  safehomes?: INavSafehome[];
  geozones?: INavGeozone[];
}

// ── Seed settings per vehicle class ──────────────────────────

function seedSettings(vehicleClass: "copter" | "plane"): Map<string, SettingEntry> {
  const m = new Map<string, SettingEntry>();
  const set = (k: string, t: number, v: number | string) => m.set(k, { type: t, value: v });

  set("nav_rth_altitude",                     SettingType.UINT16, 2500);
  set("nav_max_speed",                        SettingType.UINT16, 1000);
  set("nav_manual_speed",                     SettingType.UINT16, 800);
  set("nav_poshold_user_control_mode",        SettingType.UINT8,  0);
  set("nav_wp_max_distance_between_points",   SettingType.UINT32, 10000);
  set("failsafe_procedure",                   SettingType.UINT8,  0);
  set("failsafe_throttle",                    SettingType.UINT16, 1000);
  set("failsafe_delay",                       SettingType.UINT8,  5);
  set("platform_type",                        SettingType.UINT8,  vehicleClass === "plane" ? 1 : 0);
  set("motor_count",                          SettingType.UINT8,  vehicleClass === "plane" ? 1 : 4);
  set("servo_count",                          SettingType.UINT8,  vehicleClass === "plane" ? 5 : 0);
  set("safehome_max_distance",                SettingType.UINT32, 20000);
  set("battery_capacity",                     SettingType.UINT16, 2200);
  set("bat_cells",                            SettingType.UINT8,  4);
  set("vbat_min_cell_voltage",                SettingType.UINT8,  330);
  set("vbat_max_cell_voltage",                SettingType.UINT8,  420);
  set("vbat_warning_cell_voltage",            SettingType.UINT8,  350);

  return m;
}

// ── FC configuration seeds ───────────────────────────────────
// The demo airframe is a 5-inch iNav quad (or the small plane variant) on an
// F7 board: 8 outputs across 4 timers, a 4S 2200 mAh pack, a 4-LED strip, and
// USB + 5 UARTs. Every seed below stays consistent with `seedSettings` above.
// Instance state clones these, so one drone's edits never leak into another's.

/** iNav legacy mixer preset ids for the two demo airframes. */
const MIXER_PRESET_QUADX = 3;
const MIXER_PRESET_AIRPLANE = 14;

/**
 * Three battery profiles, all wired for the same 4S pack the telemetry tick
 * drains, differing only in capacity. Profile 0 matches `seedSettings`.
 */
const BATTERY_PROFILE_SEED: readonly INavBatteryConfig[] = [
  {
    capacityMah: 2200, capacityWarningMah: 440, capacityCriticalMah: 220,
    capacityUnit: 0, voltageSource: 0, cells: 4, cellDetect: 1,
    cellMin: 3300, cellMax: 4200, cellWarning: 3500, currentScale: 400, currentOffset: 0,
  },
  {
    capacityMah: 1500, capacityWarningMah: 300, capacityCriticalMah: 150,
    capacityUnit: 0, voltageSource: 0, cells: 4, cellDetect: 1,
    cellMin: 3300, cellMax: 4200, cellWarning: 3500, currentScale: 400, currentOffset: 0,
  },
  {
    capacityMah: 3000, capacityWarningMah: 600, capacityCriticalMah: 300,
    capacityUnit: 0, voltageSource: 0, cells: 4, cellDetect: 1,
    cellMin: 3300, cellMax: 4200, cellWarning: 3500, currentScale: 400, currentOffset: 0,
  },
];

/**
 * Two mixer profiles for the same airframe. Profile 1 reverses the yaw motors,
 * which is the real reason a non-VTOL build carries a second mixer profile.
 */
function seedMixerProfiles(vehicleClass: "copter" | "plane"): INavMixer[] {
  const plane = vehicleClass === "plane";
  const profile: INavMixer = {
    platformType: plane ? 1 : 0,
    yawMotorsReversed: false,
    hasFlaps: plane,
    appliedMixerPreset: plane ? MIXER_PRESET_AIRPLANE : MIXER_PRESET_QUADX,
    motorCount: plane ? 1 : 4,
    servoCount: plane ? 5 : 0,
  };
  return [profile, { ...profile, yawMotorsReversed: true }];
}

/** Timer output usage flags: 1 = motor, 2 = servo, 4 = LED, 8 = serial. */
const OUTPUT_USAGE_MOTOR_SERVO = 0x03;
const OUTPUT_USAGE_SERVO_LED = 0x06;
const OUTPUT_USAGE_SERVO_SERIAL = 0x0a;

/** Eight outputs sharing four timers, the usual F7 stack layout. */
const OUTPUT_MAPPING_SEED: readonly INavOutputMappingExt2Entry[] = [
  { timerId: 0, usageFlags: OUTPUT_USAGE_MOTOR_SERVO, specialLabels: 0 },
  { timerId: 0, usageFlags: OUTPUT_USAGE_MOTOR_SERVO, specialLabels: 0 },
  { timerId: 1, usageFlags: OUTPUT_USAGE_MOTOR_SERVO, specialLabels: 0 },
  { timerId: 1, usageFlags: OUTPUT_USAGE_MOTOR_SERVO, specialLabels: 0 },
  { timerId: 2, usageFlags: OUTPUT_USAGE_MOTOR_SERVO, specialLabels: 0 },
  { timerId: 2, usageFlags: OUTPUT_USAGE_MOTOR_SERVO, specialLabels: 0 },
  { timerId: 3, usageFlags: OUTPUT_USAGE_SERVO_LED, specialLabels: 0 },
  { timerId: 3, usageFlags: OUTPUT_USAGE_SERVO_SERIAL, specialLabels: 0 },
];

/**
 * iNav outputMode_e per timer: 0 = AUTO, 1 = MOTORS, 2 = SERVOS, 3 = LED.
 * Timers 0 and 1 carry the four motors, timer 3 the servo and LED pads.
 */
const TIMER_OUTPUT_MODE_SEED: readonly INavTimerOutputModeEntry[] = [
  { timerId: 0, mode: 1 },
  { timerId: 1, mode: 1 },
  { timerId: 2, mode: 0 },
  { timerId: 3, mode: 2 },
];

/** Servo slots iNav reports regardless of how many the mixer actually drives. */
const SERVO_SLOT_COUNT = 8;

/** Unassigned servo slot: 1000-2000 us travel, iNav's no-forward sentinel 255. */
const SERVO_CONFIG_DEFAULT: Readonly<INavServoConfig> = {
  rate: 100, min: 1000, max: 2000, middle: 1500,
  forwardFromChannel: 255, reversedInputSources: 0, flags: 0,
};

/** iNav tempSensorType_e: 0 = none, 1 = LM75, 2 = DS18B20. Alarms in 0.1 C. */
const TEMP_SENSOR_SLOT_COUNT = 8;

/** One 1-wire ESC probe and one I2C regulator probe; the rest unpopulated. */
const TEMP_SENSOR_SEED: readonly INavTempSensorConfigEntry[] = [
  {
    type: 2, address: [0x28, 0x1a, 0x4c, 0x0b, 0x00, 0x00, 0x80, 0x3f],
    alarmMin: -100, alarmMax: 900, label: "ESC",
  },
  {
    type: 1, address: [0x48, 0, 0, 0, 0, 0, 0, 0],
    alarmMin: -100, alarmMax: 800, label: "VREG",
  },
];

const TEMP_SENSOR_EMPTY: Readonly<INavTempSensorConfigEntry> = {
  type: 0, address: [0, 0, 0, 0, 0, 0, 0, 0], alarmMin: 0, alarmMax: 0, label: "",
};

/** Serial function bits (serialPortFunction_e) used by the seed. */
const SERIAL_FN_MSP = 1 << 0;
const SERIAL_FN_GPS = 1 << 1;
const SERIAL_FN_RX_SERIAL = 1 << 6;
const SERIAL_FN_ESC_SENSOR = 1 << 10;

/** Baud indices into the port table: 0 = auto, 4 = 57600, 5 = 115200, 7 = 250000. */
const PORT_BAUD_DEFAULTS = {
  mspBaudRate: 5, gpsBaudRate: 4, telemetryBaudRate: 0, blackboxBaudRate: 7,
} as const;

/** USB VCP (identifier 20) plus UART1-4 and UART6 (identifiers 0-3 and 5). */
const SERIAL_PORT_SEED: readonly MspSerialPort[] = [
  { identifier: 20, functions: SERIAL_FN_MSP, ...PORT_BAUD_DEFAULTS },
  { identifier: 0, functions: SERIAL_FN_MSP, ...PORT_BAUD_DEFAULTS },
  { identifier: 1, functions: SERIAL_FN_RX_SERIAL, ...PORT_BAUD_DEFAULTS },
  { identifier: 2, functions: SERIAL_FN_GPS, ...PORT_BAUD_DEFAULTS },
  { identifier: 3, functions: 0, ...PORT_BAUD_DEFAULTS },
  { identifier: 5, functions: SERIAL_FN_ESC_SENSOR, ...PORT_BAUD_DEFAULTS },
];

/** LED_MAX_STRIP_LENGTH on the target boards. */
const LED_STRIP_LENGTH = 32;

/** Palette indices of the stock 16-colour LED table. */
const COLOR_BLACK = 0;
const COLOR_WHITE = 1;
const COLOR_RED = 2;
const COLOR_ORANGE = 3;
const COLOR_YELLOW = 4;
const COLOR_LIME_GREEN = 5;
const COLOR_GREEN = 6;
const COLOR_MINT_GREEN = 7;
const COLOR_CYAN = 8;
const COLOR_LIGHT_BLUE = 9;
const COLOR_BLUE = 10;
const COLOR_DARK_VIOLET = 11;
const COLOR_DEEP_PINK = 13;

/** Direction flag bits: N, E, S, W, up, down. */
const LED_DIR_NORTH = 1 << 0;
const LED_DIR_EAST = 1 << 1;
const LED_DIR_SOUTH = 1 << 2;
const LED_DIR_WEST = 1 << 3;
/** Overlay flag bits: bit 5 = indicator, bit 6 = warning. */
const LED_OVERLAY_INDICATOR = 1 << 5;
const LED_OVERLAY_WARNING = 1 << 6;
/** LED function index: 0 = colour, 1 = flight mode. */
const LED_FN_COLOR = 0;
const LED_FN_FLIGHT_MODE = 1;

/**
 * Pack one LED config the way the strip panel unpacks it: y bits 0-3, x bits
 * 4-7, function bits 8-11, overlays bits 12-21, colour bits 22-25, directions
 * bits 26-31. The final shift keeps it an unsigned 32-bit value.
 */
function packLedConfig(
  x: number, y: number, fn: number, overlays: number, color: number, directions: number,
): number {
  return (
    (((x & 0x0f) << 4) | (y & 0x0f)) |
    ((fn & 0x0f) << 8) |
    ((overlays & 0x3ff) << 12) |
    ((color & 0x0f) << 22) |
    ((directions & 0x3f) << 26)
  ) >>> 0;
}

/** Four arm LEDs on the 16x16 grid; the rest of the strip is unconfigured. */
function seedLedStrip(): number[] {
  const leds = new Array<number>(LED_STRIP_LENGTH).fill(0);
  leds[0] = packLedConfig(0, 0, LED_FN_FLIGHT_MODE, LED_OVERLAY_INDICATOR, COLOR_WHITE, LED_DIR_NORTH | LED_DIR_WEST);
  leds[1] = packLedConfig(15, 0, LED_FN_FLIGHT_MODE, LED_OVERLAY_INDICATOR, COLOR_WHITE, LED_DIR_NORTH | LED_DIR_EAST);
  leds[2] = packLedConfig(15, 15, LED_FN_COLOR, LED_OVERLAY_WARNING, COLOR_RED, LED_DIR_SOUTH | LED_DIR_EAST);
  leds[3] = packLedConfig(0, 15, LED_FN_COLOR, LED_OVERLAY_WARNING, COLOR_RED, LED_DIR_SOUTH | LED_DIR_WEST);
  return leds;
}

/** The stock 16-entry HSV palette (hue 0-359, saturation and value 0-255). */
const LED_COLOR_SEED: readonly HsvColor[] = [
  { h: 0, s: 0, v: 0 },       // black
  { h: 0, s: 0, v: 255 },     // white
  { h: 0, s: 255, v: 255 },   // red
  { h: 30, s: 255, v: 255 },  // orange
  { h: 60, s: 255, v: 255 },  // yellow
  { h: 90, s: 255, v: 255 },  // lime green
  { h: 120, s: 255, v: 255 }, // green
  { h: 150, s: 255, v: 255 }, // mint green
  { h: 180, s: 255, v: 255 }, // cyan
  { h: 210, s: 255, v: 255 }, // light blue
  { h: 240, s: 255, v: 255 }, // blue
  { h: 270, s: 255, v: 255 }, // dark violet
  { h: 300, s: 255, v: 255 }, // magenta
  { h: 330, s: 255, v: 255 }, // deep pink
  { h: 0, s: 0, v: 0 },
  { h: 0, s: 0, v: 0 },
];

/** Per-mode direction colours: mode 0-5 x direction 0-5 (N, E, S, W, up, down). */
const LED_MODE_DIRECTION_COLORS: ReadonlyArray<readonly number[]> = [
  [COLOR_WHITE, COLOR_DARK_VIOLET, COLOR_RED, COLOR_DEEP_PINK, COLOR_BLUE, COLOR_ORANGE],
  [COLOR_LIME_GREEN, COLOR_DARK_VIOLET, COLOR_ORANGE, COLOR_DEEP_PINK, COLOR_BLUE, COLOR_ORANGE],
  [COLOR_BLUE, COLOR_DARK_VIOLET, COLOR_YELLOW, COLOR_DEEP_PINK, COLOR_BLUE, COLOR_ORANGE],
  [COLOR_CYAN, COLOR_DARK_VIOLET, COLOR_YELLOW, COLOR_DEEP_PINK, COLOR_BLUE, COLOR_ORANGE],
  [COLOR_MINT_GREEN, COLOR_DARK_VIOLET, COLOR_ORANGE, COLOR_DEEP_PINK, COLOR_BLUE, COLOR_ORANGE],
  [COLOR_LIGHT_BLUE, COLOR_DARK_VIOLET, COLOR_RED, COLOR_DEEP_PINK, COLOR_BLUE, COLOR_ORANGE],
];

/** Special-colour slots (mode 6, functions 0-10). */
const LED_SPECIAL_COLORS: readonly number[] = [
  COLOR_GREEN, COLOR_BLUE, COLOR_WHITE, COLOR_BLACK, COLOR_BLACK,
  COLOR_RED, COLOR_ORANGE, COLOR_GREEN, COLOR_BLACK, COLOR_BLACK, COLOR_BLACK,
];

/** Mode index of the special-colour group and of the aux-channel entry. */
const LED_SPECIAL_MODE = 6;
const LED_AUX_MODE = 7;

/**
 * The 48 mode-colour triplets a real FC returns: 36 mode/direction entries,
 * 11 special colours, then the aux entry whose `color` is an RC channel.
 */
function seedLedModeColors(): BfLedModeColor[] {
  const out: BfLedModeColor[] = [];
  LED_MODE_DIRECTION_COLORS.forEach((colors, mode) => {
    colors.forEach((color, fun) => out.push({ mode, fun, color }));
  });
  LED_SPECIAL_COLORS.forEach((color, fun) => out.push({ mode: LED_SPECIAL_MODE, fun, color }));
  out.push({ mode: LED_AUX_MODE, fun: 0, color: 0 });
  return out;
}

/** OSD item count, matching the `getOsdLayoutsHeader()` the mock reports. */
const OSD_ITEM_COUNT = 79;
/** MSP_OSD_CONFIG flags bit 0: the OSD feature is enabled. */
const OSD_FLAG_FEATURE_ENABLED = 0x01;

/**
 * Packed OSD element position: x bits 0-4, y bits 5-10, page bits 11-14,
 * visible bit 15 — the layout the OSD editor encodes and decodes.
 */
function packOsdPosition(x: number, y: number, visible: boolean): number {
  return (x & 0x1f) | ((y & 0x3f) << 5) | (visible ? 0x8000 : 0);
}

/**
 * Elements a stock layout shows, as `[itemIndex, x, y]`. Every other slot
 * reads back at position 0 with the visible bit clear.
 */
const OSD_VISIBLE_SEED: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 1], [1, 12, 1], [2, 15, 8], [3, 14, 2], [5, 22, 1], [6, 1, 11],
  [7, 13, 11], [8, 10, 12], [9, 1, 7], [11, 1, 12], [12, 1, 13], [13, 26, 6],
  [14, 19, 1], [15, 23, 7], [22, 12, 2], [30, 14, 9], [31, 25, 9],
];

function seedOsdItems(): Array<{ position: number }> {
  const items = Array.from({ length: OSD_ITEM_COUNT }, () => ({ position: 0 }));
  for (const [idx, x, y] of OSD_VISIBLE_SEED) items[idx] = { position: packOsdPosition(x, y, true) };
  return items;
}

/** Eight live global-variable slots, as logic conditions would leave them. */
const GVAR_SEED: readonly number[] = [0, 1, 250, 0, 0, 1500, 0, 0];

// ── INavMockProtocol ──────────────────────────────────────────

/**
 * Full DroneProtocol implementation simulating an iNav flight controller.
 *
 * iNav-only surface (safehomes, geozones, multi-mission) is exposed as public
 * methods beyond the DroneProtocol interface. Formal DroneProtocol extension
 * follows in the mission and geozone module.
 */
export class INavMockProtocol implements DroneProtocol {
  readonly protocolName = "msp";

  private _connected = false;
  private _vehicleInfo: VehicleInfo;
  private cbs: MockCallbackArrays = createCallbackArrays();
  private tickTimers: ReturnType<typeof setInterval>[] = [];

  // In-memory state ──────────────────────────────────────────
  private settingStore: Map<string, SettingEntry>;
  private ezTune: INavEzTune = {
    enabled: false, filterHz: 110, axisRatio: 100, response: 50, damping: 50,
    stability: 50, aggressiveness: 50, rate: 50, expo: 50, snappiness: 50,
  };
  private osdAlarms: INavOsdAlarms = {
    rssi: 30, flyMinutes: 10, maxAltitude: 100, distance: 1000, maxNegAltitude: 5,
    gforce: 500, gforceAxisMin: -100, gforceAxisMax: 500, current: 30,
    imuTempMin: -200, imuTempMax: 600, baroTempMin: -200, baroTempMax: 600,
    adsbDistanceWarning: 2000, adsbDistanceAlert: 1000,
  };
  private osdPreferences: INavOsdPreferences = {
    videoSystem: 0, mainVoltageDecimals: 1, ahiReverseRoll: 0, crosshairsStyle: 0,
    leftSidebarScroll: 0, rightSidebarScroll: 0, sidebarScrollArrows: 0,
    units: 1, statsEnergyUnit: 0, adsbWarningStyle: 0,
  };
  private waypoints: INavWaypoint[] = [];
  private _lastManualControl: ManualControlSample | null = null;
  private _lastPositionTarget: PositionTargetSample | null = null;
  private _lastAttitudeTarget: AttitudeTargetSample | null = null;
  private safehomeSlots: Array<INavSafehome | null> = Array(16).fill(null);
  private geozoneSlots: Array<INavGeozone | null> = Array(15).fill(null);

  // Telemetry drift state ────────────────────────────────────
  private lat: number;
  private lon: number;
  private battery = 100;
  private yaw = 0;
  private roll = 0;
  private pitch = 0;
  private sats = 12;
  private readonly baseLat: number;
  private readonly baseLon: number;

  constructor(config: INavMockConfig) {
    this._vehicleInfo = config.vehicleClass === "plane" ? INAV_PLANE_VEHICLE_INFO : INAV_QUAD_VEHICLE_INFO;
    this.settingStore = seedSettings(config.vehicleClass);
    this.mixerProfiles = seedMixerProfiles(config.vehicleClass);

    // Seed provided state
    if (config.missionWaypoints) this.waypoints = [...config.missionWaypoints];
    if (config.safehomes) {
      for (const sh of config.safehomes) {
        if (sh.index >= 0 && sh.index < 16) this.safehomeSlots[sh.index] = { ...sh };
      }
    }
    if (config.geozones) {
      for (const gz of config.geozones) {
        if (gz.index >= 0 && gz.index < 15) this.geozoneSlots[gz.index] = { ...gz };
      }
    }

    // Base position: just south-west of Bangalore (offset from main demo cluster)
    this.baseLat = config.vehicleClass === "plane" ? 12.920 : 12.925;
    this.baseLon = config.vehicleClass === "plane" ? 77.595 : 77.600;
    this.lat = this.baseLat;
    this.lon = this.baseLon;
  }

  // ── Connection ──────────────────────────────────────────────

  get isConnected(): boolean { return this._connected; }

  async connect(_t: Transport): Promise<VehicleInfo> {
    await new Promise<void>((r) => setTimeout(r, 300));
    this._connected = true;
    this._startTelemetryTick();
    return this._vehicleInfo;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._stopTelemetryTick();
  }

  // ── Info ────────────────────────────────────────────────────

  getVehicleInfo(): VehicleInfo { return this._vehicleInfo; }
  getCapabilities(): ProtocolCapabilities { return inavHandler.getCapabilities(); }
  getFirmwareHandler(): FirmwareHandler { return inavHandler; }

  // ── Settings (iNav name-based system) ──────────────────────

  /** Build a SettingInfo for a stored (or absent) setting. */
  private synthSettingInfo(name: string, index = 0): SettingInfo {
    const entry = this.settingStore.get(name);
    const type = entry?.type ?? SettingType.UINT8;
    return {
      name, pgId: 0, type, section: 0, mode: 0,
      min: 0, max: type === SettingType.STRING ? 0 : 0xffffffff,
      index, profileCurrent: 0, profileCount: 1,
      value: entry ? Number(entry.value) : 0,
    };
  }

  /**
   * Name-indexed settings surface (`DroneProtocol.settings`).
   *
   * Reads/writes the in-memory seed map with no MSP round-trip. Unknown names
   * read back as a zero uint8 and write into the store, so settings panels that
   * address names outside the seed still load and round-trip in demo mode.
   */
  settings: SettingsCapability = {
    getSetting: async (name) => {
      const entry = this.settingStore.get(name);
      return entry ? settingEntryToValue(entry) : { type: "uint8", value: 0 };
    },
    setSetting: async (name, value) => {
      const existing = this.settingStore.get(name);
      const type = existing?.type ?? SettingType.UINT8;
      const coerced = type === SettingType.STRING ? String(value) : Number(value);
      this.settingStore.set(name, { type, value: coerced });
      return ok(`${name} set`);
    },
    getSettingInfo: async (name) => this.synthSettingInfo(name),
    enumerate: async () => {
      let i = 0;
      return [...this.settingStore.keys()].map((name) => this.synthSettingInfo(name, i++));
    },
  };

  // ── iNav config blocks (EZ Tune + OSD) ─────────────────────

  async getEzTune(): Promise<INavEzTune> { return { ...this.ezTune }; }
  async setEzTune(cfg: INavEzTune): Promise<CommandResult> { this.ezTune = { ...cfg }; return ok("EZ Tune saved"); }

  async getOsdLayoutsHeader(): Promise<INavOsdLayoutsHeader> { return { layoutCount: 4, itemCount: 79, variant: 0 }; }
  async getOsdAlarms(): Promise<INavOsdAlarms> { return { ...this.osdAlarms }; }
  async setOsdAlarms(a: INavOsdAlarms): Promise<CommandResult> { this.osdAlarms = { ...a }; return ok("OSD alarms saved"); }
  async getOsdPreferences(): Promise<INavOsdPreferences> { return { ...this.osdPreferences }; }
  async setOsdPreferences(p: INavOsdPreferences): Promise<CommandResult> { this.osdPreferences = { ...p }; return ok("OSD preferences saved"); }
  async setCustomOsdElement(): Promise<CommandResult> { return ok("Custom OSD element saved"); }

  // ── Mission (iNav 60-slot, multi-mission) ──────────────────

  async uploadMission(items: MissionItem[]): Promise<CommandResult> {
    this.waypoints = items.map((item, i) => ({
      number: i + 1,
      action: INAV_WP_ACTION.WAYPOINT,
      lat: item.x / 1e7,
      lon: item.y / 1e7,
      // MissionItem.z is meters (MAVLink convention). INavWaypoint.altitude is centimeters.
      altitude: Math.round(item.z * 100),
      p1: Math.round(item.param1 ?? 0),
      p2: Math.round(item.param2 ?? 0),
      p3: Math.round(item.param3 ?? 0),
      flag: i === items.length - 1 ? INAV_WP_FLAG_LAST : 0,
    }));
    return ok(`${items.length} waypoints uploaded`);
  }

  async downloadMission(): Promise<MissionItem[]> {
    await new Promise<void>((r) => setTimeout(r, 400));
    return this.waypoints.map((wp, i) => ({
      seq: i,
      frame: 3,
      command: 16,
      current: i === 0 ? 1 : 0,
      autocontinue: 1,
      param1: wp.p1,
      param2: wp.p2,
      param3: wp.p3,
      param4: 0,
      x: Math.round(wp.lat * 1e7),
      y: Math.round(wp.lon * 1e7),
      // INavWaypoint.altitude is centimeters. MissionItem.z is meters.
      z: wp.altitude / 100,
    }));
  }

  async setCurrentMissionItem(): Promise<CommandResult> { return ok("Mission item set"); }
  async clearMission(): Promise<CommandResult> { this.waypoints = []; return ok("Mission cleared"); }

  // ── Motor and servo mixer CRUD (demo mode) ──────────────────────

  private motorMixerRules: MotorMixerRule[] = [
    { throttle: 1, roll: -1, pitch:  1, yaw: -1 },
    { throttle: 1, roll: -1, pitch: -1, yaw:  1 },
    { throttle: 1, roll:  1, pitch:  1, yaw:  1 },
    { throttle: 1, roll:  1, pitch: -1, yaw: -1 },
  ];

  private servoMixerRules: INavServoMixerRule[] = [];

  async downloadMotorMixer(): Promise<MotorMixerRule[]> {
    await new Promise<void>((r) => setTimeout(r, 120));
    return this.motorMixerRules.map((r) => ({ ...r }));
  }

  async uploadMotorMixer(rules: MotorMixerRule[]): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 180));
    this.motorMixerRules = rules.slice(0, 16).map((r) => ({ ...r }));
  }

  async downloadServoMixer(): Promise<INavServoMixerRule[]> {
    await new Promise<void>((r) => setTimeout(r, 120));
    return this.servoMixerRules.map((r) => ({ ...r }));
  }

  async uploadServoMixer(rules: INavServoMixerRule[]): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 180));
    this.servoMixerRules = rules.slice(0, 32).map((r) => ({ ...r }));
  }

  /** Read the raw INavWaypoint slots : used by tests and iNav-specific panels. */
  getINavWaypoints(): INavWaypoint[] { return [...this.waypoints]; }

  // ── Safehome CRUD (iNav-only surface) ───────────────────────
  // iNav-only surface; formal DroneProtocol extension follows in the mission and geozone module.

  getSafehome(index: number): INavSafehome | null {
    if (index < 0 || index >= 16) return null;
    return this.safehomeSlots[index] ? { ...this.safehomeSlots[index]! } : null;
  }

  getAllSafehomes(): Array<INavSafehome | null> {
    return this.safehomeSlots.map((s) => s ? { ...s } : null);
  }

  setSafehome(safehome: INavSafehome): CommandResult {
    if (safehome.index < 0 || safehome.index >= 16) {
      return { success: false, resultCode: 1, message: "Index out of range (0-15)" };
    }
    this.safehomeSlots[safehome.index] = { ...safehome };
    return ok(`Safehome ${safehome.index} saved`);
  }

  clearSafehome(index: number): CommandResult {
    if (index < 0 || index >= 16) {
      return { success: false, resultCode: 1, message: "Index out of range (0-15)" };
    }
    this.safehomeSlots[index] = null;
    return ok(`Safehome ${index} cleared`);
  }

  // ── Geozone CRUD (iNav-only surface) ───────────────────────
  // iNav-only surface; formal DroneProtocol extension follows in the mission and geozone module.

  getGeozone(index: number): INavGeozone | null {
    if (index < 0 || index >= 15) return null;
    return this.geozoneSlots[index] ? { ...this.geozoneSlots[index]! } : null;
  }

  getAllGeozones(): Array<INavGeozone | null> {
    return this.geozoneSlots.map((g) => g ? { ...g } : null);
  }

  setGeozone(zone: INavGeozone): CommandResult {
    if (zone.index < 0 || zone.index >= 15) {
      return { success: false, resultCode: 1, message: "Index out of range (0-14)" };
    }
    this.geozoneSlots[zone.index] = { ...zone, vertices: zone.vertices ? [...zone.vertices] : undefined };
    return ok(`Geozone ${zone.index} saved`);
  }

  clearGeozone(index: number): CommandResult {
    if (index < 0 || index >= 15) {
      return { success: false, resultCode: 1, message: "Index out of range (0-14)" };
    }
    this.geozoneSlots[index] = null;
    return ok(`Geozone ${index} cleared`);
  }

  // ── FC configuration blocks ─────────────────────────────────
  // The surface the real MSP adapter answers for iNav: battery and mixer
  // profiles, output mapping, servos, temperature sensors, MC braking, serial
  // ports, DShot, LED strip, OSD, and global variables. Every reader answers
  // from instance state and every writer mutates it, so a panel's
  // save-then-reload round trip behaves the same in demo mode as on hardware.

  private batteryProfiles: INavBatteryConfig[] = BATTERY_PROFILE_SEED.map((p) => ({ ...p }));
  private activeBatteryProfile = 0;
  private mixerProfiles: INavMixer[];
  private activeMixerProfile = 0;
  /** iNav nav_mc_braking_* defaults. */
  private mcBraking: INavMcBraking = {
    speedThreshold: 100, disengageSpeed: 75, timeout: 2000, boostFactor: 100,
    boostTimeout: 750, boostSpeedThreshold: 150, boostDisengage: 100, bankAngle: 40,
  };
  private outputMapping: INavOutputMappingExt2Entry[] = OUTPUT_MAPPING_SEED.map((e) => ({ ...e }));
  private timerOutputModes: INavTimerOutputModeEntry[] = TIMER_OUTPUT_MODE_SEED.map((e) => ({ ...e }));
  private servoConfigs: INavServoConfig[] =
    Array.from({ length: SERVO_SLOT_COUNT }, () => ({ ...SERVO_CONFIG_DEFAULT }));
  private tempSensorConfigs: INavTempSensorConfigEntry[] =
    Array.from({ length: TEMP_SENSOR_SLOT_COUNT }, (_, i) => {
      const seed = TEMP_SENSOR_SEED[i] ?? TEMP_SENSOR_EMPTY;
      return { ...seed, address: [...seed.address] };
    });
  private serialPorts: MspSerialPort[] = SERIAL_PORT_SEED.map((p) => ({ ...p }));
  /** Null until the first read, then true: iNav 7 answers the 32-bit MSP2 config. */
  private serialUsesV2: boolean | null = null;
  private ledStrip: number[] = seedLedStrip();
  private ledColors: HsvColor[] = LED_COLOR_SEED.map((c) => ({ ...c }));
  private ledModeColors: BfLedModeColor[] = seedLedModeColors();
  private osdItems: Array<{ position: number }> = seedOsdItems();
  private gvarValues: number[] = [...GVAR_SEED];
  private _lastDshotCommand: INavMockDshotCommand | null = null;

  // Battery profiles ───────────────────────────────────────────

  async getBatteryConfig(): Promise<INavBatteryConfig> {
    return { ...this.batteryProfiles[this.activeBatteryProfile] };
  }

  async setBatteryConfig(cfg: INavBatteryConfig): Promise<CommandResult> {
    this.batteryProfiles[this.activeBatteryProfile] = { ...cfg };
    this._syncBatterySettings();
    return ok("Battery config saved");
  }

  async selectBatteryProfile(idx: number): Promise<CommandResult> {
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.batteryProfiles.length) {
      return {
        success: false, resultCode: 1,
        message: `Battery profile out of range (0-${this.batteryProfiles.length - 1})`,
      };
    }
    this.activeBatteryProfile = idx;
    this._syncBatterySettings();
    return ok(`Battery profile ${idx} selected`);
  }

  /**
   * The named settings and the battery parameter group are one store on a real
   * FC, so a profile write or switch has to move both. Cell voltages are mV in
   * the config block and tens of mV in the named settings.
   */
  private _syncBatterySettings(): void {
    const cfg = this.batteryProfiles[this.activeBatteryProfile];
    this.settingStore.set("battery_capacity", { type: SettingType.UINT16, value: cfg.capacityMah });
    this.settingStore.set("bat_cells", { type: SettingType.UINT8, value: cfg.cells });
    this.settingStore.set("vbat_min_cell_voltage", { type: SettingType.UINT8, value: Math.round(cfg.cellMin / 10) });
    this.settingStore.set("vbat_max_cell_voltage", { type: SettingType.UINT8, value: Math.round(cfg.cellMax / 10) });
    this.settingStore.set("vbat_warning_cell_voltage", { type: SettingType.UINT8, value: Math.round(cfg.cellWarning / 10) });
  }

  // Mixer profiles ─────────────────────────────────────────────

  async getMixerConfig(): Promise<INavMixer> {
    return { ...this.mixerProfiles[this.activeMixerProfile] };
  }

  async selectMixerProfile(idx: number): Promise<CommandResult> {
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.mixerProfiles.length) {
      return {
        success: false, resultCode: 1,
        message: `Mixer profile out of range (0-${this.mixerProfiles.length - 1})`,
      };
    }
    this.activeMixerProfile = idx;
    const mixer = this.mixerProfiles[idx];
    this.settingStore.set("platform_type", { type: SettingType.UINT8, value: mixer.platformType });
    this.settingStore.set("motor_count", { type: SettingType.UINT8, value: mixer.motorCount });
    this.settingStore.set("servo_count", { type: SettingType.UINT8, value: mixer.servoCount });
    return ok(`Mixer profile ${idx} selected`);
  }

  // Outputs, servos, temperature sensors ───────────────────────

  async getOutputMapping(): Promise<INavOutputMappingExt2Entry[]> {
    return this.outputMapping.map((e) => ({ ...e }));
  }

  async getTimerOutputModes(): Promise<INavTimerOutputModeEntry[]> {
    return this.timerOutputModes.map((e) => ({ ...e }));
  }

  async setTimerOutputMode(entries: INavTimerOutputModeEntry[]): Promise<CommandResult> {
    // A real FC ignores a timer id its target does not have, so only the
    // timers this board reports move.
    for (const entry of entries) {
      const slot = this.timerOutputModes.find((t) => t.timerId === entry.timerId);
      if (slot) slot.mode = entry.mode;
    }
    return ok("Timer output modes saved");
  }

  async getServoConfigs(): Promise<INavServoConfig[]> {
    return this.servoConfigs.map((s) => ({ ...s }));
  }

  async setServoConfig(idx: number, cfg: INavServoConfig): Promise<CommandResult> {
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.servoConfigs.length) {
      return {
        success: false, resultCode: 1,
        message: `Servo index out of range (0-${this.servoConfigs.length - 1})`,
      };
    }
    this.servoConfigs[idx] = { ...cfg };
    return ok(`Servo ${idx} config saved`);
  }

  async getTempSensorConfigs(): Promise<INavTempSensorConfigEntry[]> {
    return this.tempSensorConfigs.map((s) => ({ ...s, address: [...s.address] }));
  }

  // MC braking ─────────────────────────────────────────────────

  async getMcBraking(): Promise<INavMcBraking> { return { ...this.mcBraking }; }

  async setMcBraking(braking: INavMcBraking): Promise<CommandResult> {
    this.mcBraking = { ...braking };
    return ok("MC braking saved");
  }

  // Serial ports ───────────────────────────────────────────────

  async getSerialConfig(): Promise<MspSerialPort[]> {
    // iNav 7 answers MSP2_COMMON_SERIAL_CONFIG, so the 32-bit function mask
    // (bits above 15) is live once a read has happened.
    this.serialUsesV2 = true;
    return this.serialPorts.map((p) => ({ ...p }));
  }

  serialConfigExtended(): boolean { return this.serialUsesV2 === true; }

  async setSerialConfig(ports: MspSerialPort[]): Promise<CommandResult> {
    this.serialPorts = ports.map((p) => ({ ...p }));
    return ok("Serial config saved");
  }

  // DShot ──────────────────────────────────────────────────────

  /**
   * Fire-and-forget like the real adapter: the FC acts on a DShot special
   * command only while disarmed and never replies.
   */
  async sendDshotCommand(commandType: number, motorIndex: number, commands: number[]): Promise<CommandResult> {
    this._lastDshotCommand = { commandType, motorIndex, commands: [...commands] };
    return ok("DShot command sent");
  }

  /** Last DShot special command handed to this mock, or null if none. */
  getLastDshotCommand(): INavMockDshotCommand | null {
    if (!this._lastDshotCommand) return null;
    return { ...this._lastDshotCommand, commands: [...this._lastDshotCommand.commands] };
  }

  // OSD ────────────────────────────────────────────────────────

  /**
   * The video system, units, RSSI alarm, and capacity warning come from the
   * OSD preference, alarm, and battery state this mock already holds, so the
   * config block cannot disagree with the panels that write those.
   */
  async getOsdConfig(): Promise<MspOsdConfig> {
    return {
      flags: OSD_FLAG_FEATURE_ENABLED,
      videoSystem: this.osdPreferences.videoSystem,
      units: this.osdPreferences.units,
      rssiAlarm: this.osdAlarms.rssi,
      capacityWarning: this.batteryProfiles[this.activeBatteryProfile].capacityWarningMah,
      items: this.osdItems.map((i) => ({ ...i })),
    };
  }

  async writeOsdLayout(items: Array<{ index: number; position: number }>, videoSystem?: number): Promise<CommandResult> {
    if (videoSystem !== undefined) this.osdPreferences.videoSystem = videoSystem;
    for (const item of items) {
      if (item.index >= 0 && item.index < this.osdItems.length) {
        this.osdItems[item.index] = { position: item.position };
      }
    }
    return ok(`${items.length} OSD elements saved`);
  }

  /**
   * One MSP_OSD_CHAR_WRITE per glyph on hardware, so the progress callback
   * fires per glyph here too and the upload takes real wall time.
   */
  async uploadOsdFont(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult> {
    for (let i = 0; i < glyphs.length; i++) {
      await new Promise<void>((r) => setTimeout(r, 2));
      onProgress?.(i + 1, glyphs.length);
    }
    return ok(`Wrote ${glyphs.length} glyphs`);
  }

  // LED strip ──────────────────────────────────────────────────

  async getLedStripConfig(): Promise<number[]> { return [...this.ledStrip]; }

  async setLedStripConfig(leds: number[]): Promise<CommandResult> {
    // The FC takes one write per LED index and leaves untouched slots alone.
    const written = Math.min(leds.length, this.ledStrip.length);
    for (let i = 0; i < written; i++) this.ledStrip[i] = leds[i] >>> 0;
    return ok(`${written} LEDs saved`);
  }

  async getLedColors(): Promise<HsvColor[]> { return this.ledColors.map((c) => ({ ...c })); }

  async setLedColors(colors: HsvColor[]): Promise<CommandResult> {
    this.ledColors = colors.map((c) => ({ ...c }));
    return ok("LED palette saved");
  }

  async getLedStripModeColors(): Promise<BfLedModeColor[]> {
    return this.ledModeColors.map((m) => ({ ...m }));
  }

  async setLedStripModeColor(mode: number, fun: number, color: number): Promise<CommandResult> {
    const slot = this.ledModeColors.find((m) => m.mode === mode && m.fun === fun);
    if (slot) slot.color = color;
    else this.ledModeColors.push({ mode, fun, color });
    return ok(`Mode colour ${mode}/${fun} saved`);
  }

  // Programming global variables ───────────────────────────────

  async downloadGvarStatus(): Promise<INavGvarStatus> { return { values: [...this.gvarValues] }; }

  // FTP ────────────────────────────────────────────────────────

  /**
   * MSP has no MAVLink FTP transport. Refuse the way the real MSP adapter
   * does rather than hand back fabricated bytes.
   */
  async downloadFileViaFtp(): Promise<Uint8Array> {
    throw new Error("MAVLink FTP is not available over MSP");
  }

  // ── Commands ────────────────────────────────────────────────

  async arm(): Promise<CommandResult>   { this._emit("statusText", 6, "Arming motors"); return ok("Armed"); }
  async disarm(): Promise<CommandResult> { this._emit("statusText", 6, "Disarming motors"); return ok("Disarmed"); }
  async setFlightMode(m: UnifiedFlightMode): Promise<CommandResult> { this._emit("statusText", 6, `Mode change to ${m}`); return ok(`Mode: ${m}`); }
  // The navigation commands mirror the real adapter: iNav drives them by moving
  // an AUX switch into its mode range, and the demo aircraft has NAV RTH, NAV
  // LAUNCH, NAV WP and NAV POSHOLD assigned. Land is the exception and refuses
  // the same way, because iNav has no separate landing mode to switch to.
  async returnToLaunch(): Promise<CommandResult>   { this._emit("statusText", 6, "Returning to launch"); return ok("RTL"); }
  async land(): Promise<CommandResult>             { return INAV_NO_LAND; }
  async takeoff(alt: number): Promise<CommandResult> { this._emit("statusText", 6, `Taking off to ${alt}m`); return ok(`Takeoff ${alt}m`); }
  async killSwitch(confirmed: boolean): Promise<CommandResult> {
    if (!confirmed) return { success: false, resultCode: -1, message: "Flight termination requires explicit confirmation" };
    this._emit("statusText", 2, "KILL SWITCH ACTIVATED");
    return ok("Kill switch");
  }
  async guidedGoto(): Promise<CommandResult>       { return INAV_NO_GOTO; }
  async pauseMission(): Promise<CommandResult>     { return ok("Mission paused"); }
  async resumeMission(): Promise<CommandResult>    { return ok("Mission resumed"); }
  async commitParamsToFlash(): Promise<CommandResult> { return ok("Params saved to flash"); }
  async setHome(): Promise<CommandResult>          { return ok("Home set"); }
  async changeSpeed(): Promise<CommandResult>      { return ok("Speed changed"); }
  async setYaw(): Promise<CommandResult>           { return ok("Yaw set"); }
  async setGeoFenceEnabled(): Promise<CommandResult> { return ok("Geofence updated"); }
  async setServo(): Promise<CommandResult>         { return ok("Servo set"); }
  async cameraTrigger(): Promise<CommandResult>    { return ok("Camera triggered"); }
  async setGimbalAngle(): Promise<CommandResult>   { return ok("Gimbal set"); }
  async setCameraTriggerDistance(): Promise<CommandResult> { return ok("Trigger distance set"); }
  async setGimbalMode(): Promise<CommandResult>    { return ok("Gimbal mode set"); }
  async setGimbalROI(): Promise<CommandResult>     { return ok("Gimbal ROI set"); }
  async setRoiLocation(): Promise<CommandResult>   { return ok("ROI set"); }
  async clearRoi(): Promise<CommandResult>         { return ok("ROI cleared"); }
  async orbit(): Promise<CommandResult>            { return ok("Orbit started"); }
  async setEkfOrigin(): Promise<CommandResult>     { return ok("EKF origin set"); }
  async setEkfSourceSet(sourceSet: 1 | 2 | 3): Promise<{ ok: true } | { ok: false; reason: "px4-not-supported" | "no-ack" | "rejected" }> {
    if (sourceSet !== 1 && sourceSet !== 2 && sourceSet !== 3) {
      throw new TypeError(`setEkfSourceSet: sourceSet must be 1, 2, or 3 (received ${String(sourceSet)})`);
    }
    // iNav speaks MSP not MAVLink; the EKF source-set command has no counterpart here.
    return { ok: false, reason: "rejected" };
  }
  async startEscCalibration(): Promise<CommandResult> { return ok("ESC calibration started"); }
  async enableFence(): Promise<CommandResult>      { return ok("Fence updated"); }
  async doLandStart(): Promise<CommandResult>      { return ok("Land start"); }
  async controlVideo(): Promise<CommandResult>     { return ok("Video control"); }
  async setRelay(): Promise<CommandResult>         { return ok("Relay set"); }
  async startRxPair(): Promise<CommandResult>      { return ok("RX pair started"); }
  async setMessageInterval(): Promise<CommandResult> { return ok("Interval set"); }
  async sendCommand(): Promise<CommandResult>      { return ok("Command sent"); }
  sendManualControl(roll: number, pitch: number, throttle: number, yaw: number, buttons: number): void {
    this._lastManualControl = { roll, pitch, throttle, yaw, buttons };
  }
  sendPositionTarget(lat: number, lon: number, alt: number): void {
    this._lastPositionTarget = { lat, lon, alt };
  }
  sendAttitudeTarget(roll: number, pitch: number, yaw: number, thrust: number): void {
    this._lastAttitudeTarget = { roll, pitch, yaw, thrust };
  }
  setRcChannelValues(): void {}

  /** Last stick frame handed to this mock, or null if none. */
  getLastManualControl(): ManualControlSample | null { return this._lastManualControl; }
  /** Last guided position setpoint handed to this mock, or null if none. */
  getLastPositionTarget(): PositionTargetSample | null { return this._lastPositionTarget; }
  /** Last attitude setpoint handed to this mock, or null if none. */
  getLastAttitudeTarget(): AttitudeTargetSample | null { return this._lastAttitudeTarget; }

  async doPreArmCheck(): Promise<CommandResult> { setTimeout(() => this._emit("statusText", 6, "PreArm: Ready to arm"), 200); return ok("Pre-arm check"); }

  // ── Fence / Rally ───────────────────────────────────────────

  async uploadFence(): Promise<CommandResult> { return ok("Fence uploaded"); }
  async downloadFence() { return []; }
  async uploadRallyPoints(): Promise<CommandResult> { return ok("Rally points uploaded"); }
  async downloadRallyPoints() { return []; }

  // ── Parameters ──────────────────────────────────────────────

  getCachedParameterNames(): string[] { return []; }
  async getAllParameters(): Promise<ParameterValue[]> { return []; }
  async getParameter(name: string): Promise<ParameterValue> { return { name, value: 0, type: 9, index: -1, count: 0 }; }
  async setParameter(name: string, value: number, type = 9): Promise<CommandResult> { void type; return ok(`${name} = ${value}`); }
  async resetParametersToDefault(): Promise<CommandResult> { return ok("Parameters reset"); }

  // ── Calibration ─────────────────────────────────────────────

  async startCalibration(): Promise<CommandResult> { return ok("Calibration started"); }
  confirmAccelCalPos(): void {}
  async acceptCompassCal(): Promise<CommandResult>  { return ok("Compass cal accepted"); }
  async cancelCompassCal(): Promise<CommandResult>  { return ok("Compass cal cancelled"); }
  async cancelCalibration(): Promise<CommandResult> { return ok("Calibration cancelled"); }
  async startGnssMagCal(): Promise<CommandResult>   { return ok("GNSS mag cal started"); }

  // ── Log Download ────────────────────────────────────────────

  async getLogList(): Promise<LogEntry[]> { return []; }
  async downloadLog(_id: number, onProgress?: LogDownloadProgressCallback): Promise<Uint8Array> {
    if (onProgress) onProgress(1024, 1024);
    return new Uint8Array(1024);
  }
  async eraseAllLogs(): Promise<CommandResult> { return ok("Logs erased"); }
  cancelLogDownload(): void {}

  // ── Motor Test / Reboot ─────────────────────────────────────

  async motorTest(motor: number, throttle: number, duration: number): Promise<CommandResult> {
    this._emit("statusText", 6, `Motor ${motor} test: ${throttle}% for ${duration}s`);
    return ok(`Motor ${motor} tested`);
  }
  async rebootToBootloader(): Promise<CommandResult> { return ok("Reboot to bootloader (mock)"); }
  async reboot(): Promise<CommandResult> { this._emit("statusText", 5, "Rebooting..."); return ok("Reboot (mock)"); }

  // ── Serial ──────────────────────────────────────────────────

  sendSerialData(): void {}
  async requestMessage(): Promise<CommandResult> { return ok("Message requested"); }

  // ── Telemetry tick ──────────────────────────────────────────

  private _emit(kind: "statusText", severity: number, text: string): void;
  private _emit(...args: unknown[]): void {
    if (args[0] === "statusText") {
      const sev = args[1] as number;
      const txt = args[2] as string;
      for (const cb of this.cbs.statusTextCbs) cb({ severity: sev, text: txt });
    }
  }

  /** Start 10 Hz telemetry loop. Called on connect. */
  startMockTelemetryTick(): void {
    this._startTelemetryTick();
  }

  stopMockTelemetryTick(): void {
    this._stopTelemetryTick();
  }

  private _startTelemetryTick(): void {
    this._stopTelemetryTick();
    const now = () => Date.now();

    const tick = setInterval(() => {
      const ts = now();

      // Slow drift around base position
      this.lat = this.baseLat + Math.sin(ts / 30000) * 0.001;
      this.lon = this.baseLon + Math.cos(ts / 30000) * 0.001;

      // Attitude drift
      this.roll  = Math.sin(ts / 4000) * 12;
      this.pitch = Math.cos(ts / 5000) * 8;
      this.yaw   = ((this.yaw + 0.5) % 360);

      // Battery drain ~0.1%/sec at 10 Hz
      this.battery = Math.max(5, this.battery - 0.01);

      // GPS satellite count jitter
      this.sats = 11 + (Math.floor(ts / 5000) % 4);

      for (const cb of this.cbs.attitudeCbs) {
        cb({ roll: this.roll, pitch: this.pitch, yaw: this.yaw, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0.5, timestamp: ts });
      }
      for (const cb of this.cbs.positionCbs) {
        cb({
          lat: this.lat, lon: this.lon,
          alt: 45 + Math.sin(ts / 8000) * 5,
          relativeAlt: 45,
          heading: this.yaw, groundSpeed: 5 + Math.sin(ts / 3000) * 2,
          airSpeed: 6, climbRate: Math.cos(ts / 4000) * 0.5,
          timestamp: ts,
        });
      }
      for (const cb of this.cbs.batteryCbs) {
        const cellV = (16.8 * (this.battery / 100)) / 4;
        cb({
          voltage: 16.8 * (this.battery / 100),
          current: 8 + Math.random() * 3,
          remaining: this.battery,
          consumed: (100 - this.battery) * 14.7,
          temperature: 31 + Math.random() * 5,
          cellVoltages: [cellV, cellV, cellV, cellV],
          timestamp: ts,
        });
      }
      for (const cb of this.cbs.gpsCbs) {
        cb({
          fixType: 3, satellites: this.sats,
          hdop: 0.9 + Math.random() * 0.3,
          lat: this.lat, lon: this.lon, alt: 920,
          timestamp: ts,
        });
      }
      for (const cb of this.cbs.heartbeatCbs) {
        cb({ armed: true, mode: "POSHOLD", systemStatus: 4, vehicleInfo: this._vehicleInfo });
      }

      // iNav-specific telemetry fields land in the shared telemetry store so
      // NavStatePill, TrafficPill, and the PreArmPanel arming breakdown render
      // against demo drones just like they would against a real FC.
      const store = useTelemetryStore.getState();
      // Cycle nav state every 15 s across IDLE, POSHOLD, RTH for visual variety.
      const stateCycle = [0, 4, 13];
      const actionCycle = [0, 2, 4];
      const cycleIdx = Math.floor(ts / 15000) % stateCycle.length;
      store.setNavStatus(stateCycle[cycleIdx], actionCycle[cycleIdx]);
      // Arming flags: usually OK_TO_ARM (bit 0). Every ~30 s drop to NOT_LEVEL so
      // the PreArmPanel section shows a real blocker label.
      const flagCycle = Math.floor(ts / 30000) % 2 === 0 ? 0x00000001 : 0x00000100;
      store.setArmingFlags(flagCycle);
      // One simulated ADS-B aircraft orbiting 2 km east of the copter so the
      // TrafficPill renders a live entry with distance, altitude, and TTL.
      const orbitBearing = (ts / 200) % 360;
      const rad = (orbitBearing * Math.PI) / 180;
      const orbitLat = this.lat + (0.018 * Math.sin(rad));
      const orbitLon = this.lon + (0.018 * Math.cos(rad));
      store.setAdsbVehicles([
        {
          callsign: "DEMO01",
          icao: 0xABCDEF,
          lat: orbitLat,
          lon: orbitLon,
          alt: 1200,
          heading: (orbitBearing + 90) % 360,
          lastSeenMs: ts,
          emitterType: 1,
          ttlSec: 60,
        },
      ]);
    }, 100);

    this.tickTimers.push(tick);
  }

  private _stopTelemetryTick(): void {
    for (const t of this.tickTimers) clearInterval(t);
    this.tickTimers = [];
  }

  // ── Subscriptions ────────────────────────────────────────────

  onAttitude = (cb: AttitudeCallback) => sub(this.cbs.attitudeCbs, cb);
  onPosition = (cb: PositionCallback) => sub(this.cbs.positionCbs, cb);
  onBattery = (cb: BatteryCallback) => sub(this.cbs.batteryCbs, cb);
  onGps = (cb: GpsCallback) => sub(this.cbs.gpsCbs, cb);
  onVfr = (cb: VfrCallback) => sub(this.cbs.vfrCbs, cb);
  onRc = (cb: RcCallback) => sub(this.cbs.rcCbs, cb);
  onStatusText = (cb: StatusTextCallback) => sub(this.cbs.statusTextCbs, cb);
  onEvent = (cb: EventCallback) => sub(this.cbs.eventCbs, cb);
  onHeartbeat = (cb: HeartbeatCallback) => sub(this.cbs.heartbeatCbs, cb);
  onParameter = (cb: ParameterCallback) => sub(this.cbs.parameterCbs, cb);
  onSerialData = (cb: SerialDataCallback) => sub(this.cbs.serialDataCbs, cb);
  onSysStatus = (cb: SysStatusCallback) => sub(this.cbs.sysStatusCbs, cb);
  onRadio = (cb: RadioCallback) => sub(this.cbs.radioCbs, cb);
  onMissionProgress = (cb: MissionProgressCallback) => sub(this.cbs.missionProgressCbs, cb);
  onEkf = (cb: EkfCallback) => sub(this.cbs.ekfCbs, cb);
  onVibration = (cb: VibrationCallback) => sub(this.cbs.vibrationCbs, cb);
  onServoOutput = (cb: ServoOutputCallback) => sub(this.cbs.servoOutputCbs, cb);
  onWind = (cb: WindCallback) => sub(this.cbs.windCbs, cb);
  onTerrain = (cb: TerrainCallback) => sub(this.cbs.terrainCbs, cb);
  onMagCalProgress = (cb: MagCalProgressCallback) => sub(this.cbs.magCalProgressCbs, cb);
  onMagCalReport = (cb: MagCalReportCallback) => sub(this.cbs.magCalReportCbs, cb);
  onAccelCalPos = (cb: AccelCalPosCallback) => sub(this.cbs.accelCalPosCbs, cb);
  onHomePosition = (cb: HomePositionCallback) => sub(this.cbs.homePositionCbs, cb);
  onAutopilotVersion = (cb: AutopilotVersionCallback) => sub(this.cbs.autopilotVersionCbs, cb);
  onPowerStatus = (cb: PowerStatusCallback) => sub(this.cbs.powerStatusCbs, cb);
  onDistanceSensor = (cb: DistanceSensorCallback) => sub(this.cbs.distanceSensorCbs, cb);
  onFenceStatus = (cb: FenceStatusCallback) => sub(this.cbs.fenceStatusCbs, cb);
  onNavController = (cb: NavControllerCallback) => sub(this.cbs.navControllerCbs, cb);
  onScaledImu = (cb: ScaledImuCallback) => sub(this.cbs.scaledImuCbs, cb);
  onScaledPressure = (cb: ScaledPressureCallback) => sub(this.cbs.scaledPressureCbs, cb);
  onEstimatorStatus = (cb: EstimatorStatusCallback) => sub(this.cbs.estimatorStatusCbs, cb);
  onCameraTrigger = (cb: CameraTriggerCallback) => sub(this.cbs.cameraTriggerCbs, cb);
  onLinkLost = (cb: LinkStateCallback) => sub(this.cbs.linkLostCbs, cb);
  onLinkRestored = (cb: LinkStateCallback) => sub(this.cbs.linkRestoredCbs, cb);
  onLocalPosition = (cb: LocalPositionCallback) => sub(this.cbs.localPositionCbs, cb);
  onDebug = (cb: DebugCallback) => sub(this.cbs.debugCbs, cb);
  onGimbalAttitude = (cb: GimbalAttitudeCallback) => sub(this.cbs.gimbalAttitudeCbs, cb);
  onObstacleDistance = (cb: ObstacleDistanceCallback) => sub(this.cbs.obstacleDistanceCbs, cb);
  onCameraImageCaptured = (cb: CameraImageCapturedCallback) => sub(this.cbs.cameraImageCapturedCbs, cb);
  onExtendedSysState = (cb: ExtendedSysStateCallback) => sub(this.cbs.extendedSysStateCbs, cb);
  onFencePoint = (cb: FencePointCallback) => sub(this.cbs.fencePointCbs, cb);
  onSystemTime = (cb: SystemTimeCallback) => sub(this.cbs.systemTimeCbs, cb);
  onRawImu = (cb: RawImuCallback) => sub(this.cbs.rawImuCbs, cb);
  onRcChannelsRaw = (cb: RcChannelsRawCallback) => sub(this.cbs.rcChannelsRawCbs, cb);
  onRcChannelsOverride = (cb: RcChannelsOverrideCallback) => sub(this.cbs.rcChannelsOverrideCbs, cb);
  onMissionItem = (cb: MissionItemCallback) => sub(this.cbs.missionItemCbs, cb);
  onAltitude = (cb: AltitudeCallback) => sub(this.cbs.altitudeCbs, cb);
  onWindCov = (cb: WindCovCallback) => sub(this.cbs.windCovCbs, cb);
  onAisVessel = (cb: AisVesselCallback) => sub(this.cbs.aisVesselCbs, cb);
  onGimbalManagerInfo = (cb: GimbalManagerInfoCallback) => sub(this.cbs.gimbalManagerInfoCbs, cb);
  onGimbalManagerStatus = (cb: GimbalManagerStatusCallback) => sub(this.cbs.gimbalManagerStatusCbs, cb);
  onCanFrame = (cb: CanFrameCallback) => sub(this.cbs.canFrameCbs, cb);
  onOpticalFlow = (cb: OpticalFlowCallback) => sub(this.cbs.opticalFlowCbs, cb);
  onOpticalFlowRad = (cb: OpticalFlowRadCallback) => sub(this.cbs.opticalFlowRadCbs, cb);
  onOdometry = (cb: OdometryCallback) => sub(this.cbs.odometryCbs, cb);
  onVisionPositionEstimate = (cb: VisionPositionEstimateCallback) => sub(this.cbs.visionPositionEstimateCbs, cb);
  onVisionPositionDelta = (cb: VisionPositionDeltaCallback) => sub(this.cbs.visionPositionDeltaCbs, cb);
}
