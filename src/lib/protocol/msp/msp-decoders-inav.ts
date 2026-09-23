/**
 * iNav-specific MSP decoders.
 *
 * iNav extends MSP with navigation features: waypoints, safehomes,
 * NAV configuration, geozones, logic conditions, programming PIDs,
 * mixer profiles, and extended status. These decoders handle iNav-specific
 * MSP2 responses (0x2000+ range) and shared MSP_WP (118).
 *
 * Pure functions — each takes a DataView of the MSP response payload
 * and returns a typed object. All multi-byte values are little-endian.
 *
 * This module is a facade over the decoders/inav/ folder: implementation
 * lives in per-feature files (nav, battery, mixer, osd, tuning, sensors,
 * programming, geozones, settings-common) plus shared types/constants/helpers.
 *
 * @module protocol/msp/msp-decoders-inav
 */

// ── Constants + waypoint action enum ─────────────────────────
export { INAV_MSP, INAV_WP_ACTION, INAV_WP_FLAG_LAST, INAV_LIMITS } from "./decoders/inav/constants";

// ── Decoded result types ─────────────────────────────────────
export type {
  INavWaypoint,
  INavStatus,
  INavActiveProfiles,
  INavMisc2,
  INavSafehome,
  INavAnalog,
  INavMisc,
  INavBatteryConfig,
  INavRateProfile,
  INavAirSpeed,
  INavMixer,
  INavOsdLayoutsHeader,
  INavOsdAlarms,
  INavOsdPreferences,
  INavMcBraking,
  INavTimerOutputModeEntry,
  INavOutputMappingExt2Entry,
  INavTempSensorConfigEntry,
  INavCalibrationData,
  INavServoMixerRule,
  INavLogicCondition,
  INavGvarStatus,
  INavProgrammingPid,
  INavProgrammingPidStatus,
  INavPid,
  INavFwApproach,
  INavCustomOsdElementsInfo,
  INavCustomOsdField,
  INavCustomOsdElement,
  INavRateDynamics,
  INavEzTune,
  INavServoConfig,
  INavGeozone,
  INavGeozoneVertex,
  INavAdsbVehicle,
  INavCommonSetting,
  INavSettingInfo,
  INavPgList,
  MotorMixerRule,
} from "./decoders/inav/types";

// ── Navigation: waypoints, status, safehome, nav config, misc, FW approach ──
export {
  decodeMspWp,
  encodeMspSetWp,
  decodeMspINavStatus,
  decodeMspINavStatusMixerProfile,
  decodeMspINavMisc2,
  decodeMspINavSafehome,
  encodeMspINavSetSafehome,
  decodeMspINavMisc,
  decodeMspINavFwApproach,
} from "./decoders/inav/nav";

// ── Battery / power ──────────────────────────────────────────
export {
  decodeMspINavAnalog,
  decodeMspINavBatteryConfig,
} from "./decoders/inav/battery";

// ── Rate, PID, EzTune, MC braking ────────────────────────────
export {
  decodeMspINavRateProfile,
  decodeMspINavMcBraking,
  decodeMspINavPid,
  decodeMspINavRateDynamics,
  decodeMspINavEzTune,
} from "./decoders/inav/tuning";

// ── Mixer / servo / output mapping ───────────────────────────
export {
  decodeMspINavMixer,
  decodeMspINavTimerOutputMode,
  decodeMspINavOutputMappingExt2,
  decodeMspINavServoMixer,
  decodeMspINavServoConfig,
  decodeMspCommonMotorMixer,
} from "./decoders/inav/mixer";

// ── OSD ──────────────────────────────────────────────────────
export {
  decodeMspINavOsdLayoutsHeader,
  decodeMspINavOsdAlarms,
  decodeMspINavOsdPreferences,
  decodeMspINavCustomOsdElementsInfo,
  decodeMspINavCustomOsdElement,
} from "./decoders/inav/osd";

// ── Sensors: air speed, temperatures, ADS-B ──────────────────
export {
  decodeMspINavAirSpeed,
  decodeMspINavTempSensorConfig,
  decodeMspINavTemperatures,
  decodeMspINavCalibrationData,
  decodeMspAdsbVehicleList,
} from "./decoders/inav/sensors";

// ── Programming: logic conditions, PIDs, global variables ────
export {
  decodeMspINavLogicConditions,
  decodeMspINavLogicConditionsStatus,
  decodeMspINavGvarStatus,
  decodeMspINavProgrammingPid,
  decodeMspINavProgrammingPidStatus,
} from "./decoders/inav/programming";

// ── Geozones ─────────────────────────────────────────────────
export {
  decodeMspINavGeozone,
  decodeMspINavGeozoneVertex,
} from "./decoders/inav/geozones";

// ── MSP2 common settings ─────────────────────────────────────
export {
  decodeCommonSetting,
  decodeCommonSettingInfo,
  decodeCommonPgList,
} from "./decoders/inav/settings-common";
