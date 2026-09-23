/**
 * iNav MSP2 command identifiers and waypoint action/flag constants.
 *
 * @module protocol/msp/decoders/inav/constants
 */

export const INAV_MSP = {
  // Existing entries
  MSP2_INAV_STATUS: 0x2000,
  MSP2_INAV_OPTICAL_FLOW: 0x2001,
  MSP2_INAV_ANALOG: 0x2002,
  MSP2_INAV_MISC: 0x2003,
  MSP2_INAV_SET_MISC: 0x2004,
  MSP2_INAV_BATTERY_CONFIG: 0x2005,
  MSP2_INAV_SET_BATTERY_CONFIG: 0x2006,
  MSP2_INAV_RATE_PROFILE: 0x2007,
  MSP2_INAV_SET_RATE_PROFILE: 0x2008,
  MSP2_INAV_AIR_SPEED: 0x2009,
  MSP2_INAV_OUTPUT_MAPPING: 0x200a,
  MSP2_INAV_SAFEHOME: 0x2038,
  MSP2_INAV_SET_SAFEHOME: 0x2039,
  MSP2_INAV_MISC2: 0x203a,

  // Legacy nav config entry. This ID (0x2100) collides with MSP2_INAV_CUSTOM_OSD_ELEMENTS.
  // The shape decoded here does not match the Custom OSD Elements response format.
  // Retained as a legacy alias so existing callers are not broken; treat with caution.
  // See decodeMspINavNavConfigLegacy below.
  MSP2_INAV_NAV_CONFIG_LEGACY: 0x2100,
  /**
   * MSPv1 `MSP_NAV_STATUS`, command 121. It was declared here as `0x2101`,
   * which is an MSP2 id (and the one that collides with
   * MSP2_INAV_CUSTOM_OSD_ELEMENTS) — nothing polled it, so nav state was
   * being invented from the wrong offsets of MSP2_INAV_STATUS instead.
   */
  MSP_NAV_STATUS: 121,
  MSP_WP: 118,
  MSP_SET_WP: 209,

  // MSPv1 iNav navigation commands
  MSP_NAV_POSHOLD: 0x0c,
  MSP_SET_NAV_POSHOLD: 0x0d,
  MSP_RTH_AND_LAND_CONFIG: 21,
  MSP_SET_RTH_AND_LAND_CONFIG: 22,
  MSP_FW_CONFIG: 23,
  MSP_SET_FW_CONFIG: 24,

  // Waypoint mission storage
  MSP_WP_MISSION_LOAD: 18,
  MSP_WP_MISSION_SAVE: 19,
  MSP_WP_GETINFO: 20,
  MSP_SET_HOME_POSITION: 0xd9,

  // MSP2 common settings system
  MSP2_COMMON_SETTING: 0x1003,
  MSP2_COMMON_SET_SETTING: 0x1004,
  MSP2_COMMON_MOTOR_MIXER: 0x1005,
  MSP2_COMMON_SET_MOTOR_MIXER: 0x1006,
  MSP2_COMMON_SETTING_INFO: 0x1007,
  MSP2_COMMON_PG_LIST: 0x1008,

  // MSP2 iNav mixer
  MSP2_INAV_MIXER: 0x2010,
  MSP2_INAV_SET_MIXER: 0x2011,

  // MSP2 iNav OSD
  MSP2_INAV_OSD_LAYOUTS: 0x2012,
  MSP2_INAV_OSD_SET_LAYOUT_ITEM: 0x2013,
  MSP2_INAV_OSD_ALARMS: 0x2014,
  MSP2_INAV_OSD_SET_ALARMS: 0x2015,
  MSP2_INAV_OSD_PREFERENCES: 0x2016,
  MSP2_INAV_OSD_SET_PREFERENCES: 0x2017,

  // MSP2 iNav battery and debug
  MSP2_INAV_SELECT_BATTERY_PROFILE: 0x2018,
  MSP2_INAV_DEBUG: 0x2019,
  MSP2_INAV_BLACKBOX_CONFIG: 0x201a,
  MSP2_INAV_SET_BLACKBOX_CONFIG: 0x201b,
  MSP2_INAV_TEMP_SENSOR_CONFIG: 0x201c,
  MSP2_INAV_SET_TEMP_SENSOR_CONFIG: 0x201d,
  MSP2_INAV_TEMPERATURES: 0x201e,

  // MSP2 iNav servo and logic
  MSP2_INAV_SERVO_MIXER: 0x2020,
  MSP2_INAV_SET_SERVO_MIXER: 0x2021,
  // 0x2022 is the deprecated bulk logic-conditions getter; its firmware handler
  // returns no data (it would overflow the reply buffer). Read conditions one at
  // a time via MSP2_INAV_LOGIC_CONDITIONS_SINGLE instead.
  MSP2_INAV_LOGIC_CONDITIONS: 0x2022,
  MSP2_INAV_SET_LOGIC_CONDITIONS: 0x2023,
  // 0x2024/0x2025 are reserved IDs with no firmware handler; the overriding
  // "global function" behaviours are realized as logic-condition operations.
  MSP2_INAV_GLOBAL_FUNCTIONS: 0x2024,
  MSP2_INAV_SET_GLOBAL_FUNCTIONS: 0x2025,
  MSP2_INAV_LOGIC_CONDITIONS_STATUS: 0x2026,
  MSP2_INAV_GVAR_STATUS: 0x2027,
  // Per-index single-condition read path (replaces the dead bulk 0x2022).
  MSP2_INAV_LOGIC_CONDITIONS_SINGLE: 0x203b,
  // Set one global variable value at runtime.
  MSP2_INAV_SET_GVAR: 0x2214,

  // MSP2 iNav programming PID
  MSP2_INAV_PROGRAMMING_PID: 0x2028,
  MSP2_INAV_SET_PROGRAMMING_PID: 0x2029,
  MSP2_INAV_PROGRAMMING_PID_STATUS: 0x202a,

  // MSP2 iNav braking, output mapping, timer
  MSP2_INAV_MC_BRAKING: 0x200b,
  MSP2_INAV_SET_MC_BRAKING: 0x200c,
  MSP2_INAV_OUTPUT_MAPPING_EXT: 0x200d,
  MSP2_INAV_OUTPUT_MAPPING_EXT2: 0x210d,
  MSP2_INAV_TIMER_OUTPUT_MODE: 0x200e,
  MSP2_INAV_SET_TIMER_OUTPUT_MODE: 0x200f,

  // MSP2 iNav PID
  MSP2_INAV_PID: 0x2030,
  MSP2_INAV_SET_PID: 0x2031,

  // MSP2 iNav LED strip extended
  MSP2_INAV_LED_STRIP_CONFIG_EX: 0x2048,
  MSP2_INAV_SET_LED_STRIP_CONFIG_EX: 0x2049,

  // MSP2 iNav fixed-wing approach
  MSP2_INAV_FW_APPROACH: 0x204a,
  MSP2_INAV_SET_FW_APPROACH: 0x204b,

  // MSP2 iNav rate dynamics and EzTune
  MSP2_INAV_RATE_DYNAMICS: 0x2060,
  MSP2_INAV_SET_RATE_DYNAMICS: 0x2061,
  MSP2_INAV_EZ_TUNE: 0x2070,
  MSP2_INAV_EZ_TUNE_SET: 0x2071,

  // MSP2 iNav mixer profile
  MSP2_INAV_SELECT_MIXER_PROFILE: 0x2080,

  // MSP2 ADS-B
  MSP2_ADSB_VEHICLE_LIST: 0x2090,

  // MSP2 iNav custom OSD elements (note: 0x2100 is also MSP2_INAV_NAV_CONFIG_LEGACY above, 0x2101 is also MSP_NAV_STATUS above)
  MSP2_INAV_CUSTOM_OSD_ELEMENTS: 0x2100,
  MSP2_INAV_CUSTOM_OSD_ELEMENT: 0x2101,
  MSP2_INAV_SET_CUSTOM_OSD_ELEMENTS: 0x2102,

  // MSP2 iNav servo config
  MSP2_INAV_SERVO_CONFIG: 0x2200,
  MSP2_INAV_SET_SERVO_CONFIG: 0x2201,

  // MSP2 iNav geozone
  MSP2_INAV_GEOZONE: 0x2210,
  MSP2_INAV_SET_GEOZONE: 0x2211,
  MSP2_INAV_GEOZONE_VERTEX: 0x2212,
  MSP2_INAV_SET_GEOZONE_VERTEX: 0x2213,
} as const;

// ── iNav waypoint actions ────────────────────────────────────

export const INAV_WP_ACTION = {
  WAYPOINT: 1,
  POSHOLD_UNLIM: 2,
  POSHOLD_TIME: 3,
  RTH: 4,
  SET_POI: 5,
  JUMP: 6,
  SET_HEAD: 7,
  LAND: 8,
} as const;

/** Flag value indicating last waypoint in mission. */
export const INAV_WP_FLAG_LAST = 0xa5;

/** Fixed table sizes compiled into iNav, which MSP does not report. */
export const INAV_LIMITS = {
  /** MAX_SAFE_HOMES: MSP2_INAV_SET_SAFEHOME refuses any higher index. */
  SAFEHOMES: 8,
  /** MAX_GEOZONES_IN_CONFIG. */
  GEOZONES: 63,
  /** MAX_FW_LAND_APPOACH_SETTINGS (safehome slots plus nine more). */
  FW_APPROACHES: 17,
  /** MAX_LOGIC_CONDITIONS. */
  LOGIC_CONDITIONS: 64,
} as const;
