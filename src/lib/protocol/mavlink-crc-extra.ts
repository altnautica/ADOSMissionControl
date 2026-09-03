/**
 * Per-message CRC_EXTRA seeds and expected payload lengths for MAVLink v2.
 *
 * CRC_EXTRA values are defined by the MAVLink v2 protocol specification and
 * act as a version check. PAYLOAD_LENGTHS are used to restore zero-trimmed
 * payloads to their canonical size.
 *
 * @module protocol/mavlink-crc-extra
 */

/**
 * Per-message CRC_EXTRA seed for all decoded MAVLink messages.
 */
export const CRC_EXTRA: ReadonlyMap<number, number> = new Map([
  [0, 50],    // HEARTBEAT
  [1, 124],   // SYS_STATUS
  [11, 89],   // SET_MODE
  [20, 214],  // PARAM_REQUEST_READ
  [21, 159],  // PARAM_REQUEST_LIST
  [22, 220],  // PARAM_VALUE
  [23, 168],  // PARAM_SET
  [24, 24],   // GPS_RAW_INT
  [30, 39],   // ATTITUDE
  [33, 104],  // GLOBAL_POSITION_INT
  [41, 28],   // MISSION_SET_CURRENT
  [40, 230],  // MISSION_REQUEST (legacy float-coordinate request)
  [48, 41],   // SET_GPS_GLOBAL_ORIGIN
  [44, 221],  // MISSION_COUNT
  [47, 153],  // MISSION_ACK
  [51, 196],  // MISSION_REQUEST_INT
  [65, 118],  // RC_CHANNELS
  [69, 243],  // MANUAL_CONTROL
  [73, 38],   // MISSION_ITEM_INT
  [74, 20],   // VFR_HUD
  [75, 158],  // COMMAND_INT
  [76, 152],  // COMMAND_LONG
  [77, 143],  // COMMAND_ACK
  [147, 154], // BATTERY_STATUS
  [126, 220], // SERIAL_CONTROL
  [253, 83],  // STATUSTEXT
  [42, 28],   // MISSION_CURRENT
  [43, 132],  // MISSION_REQUEST_LIST
  [45, 232],  // MISSION_CLEAR_ALL
  [46, 11],   // MISSION_ITEM_REACHED
  [109, 185], // RADIO_STATUS
  [36, 222],  // SERVO_OUTPUT_RAW
  [136, 1],   // TERRAIN_REPORT
  [168, 1],   // WIND
  [191, 92],  // MAG_CAL_PROGRESS
  [192, 36],  // MAG_CAL_REPORT
  [241, 90],  // VIBRATION
  [193, 71],  // EKF_STATUS_REPORT (ArduPilot dialect)
  [66, 148],  // REQUEST_DATA_STREAM
  [242, 104], // HOME_POSITION
  [148, 178], // AUTOPILOT_VERSION
  [125, 203], // POWER_STATUS
  [132, 85],  // DISTANCE_SENSOR
  [162, 189], // FENCE_STATUS
  [62, 183],  // NAV_CONTROLLER_OUTPUT
  [26, 170],  // SCALED_IMU
  [29, 115],  // SCALED_PRESSURE
  [124, 87],  // GPS2_RAW
  [117, 128], // LOG_REQUEST_LIST
  [118, 56],  // LOG_ENTRY
  [119, 116], // LOG_REQUEST_DATA
  [120, 134], // LOG_DATA
  [121, 237], // LOG_ERASE
  [122, 203], // LOG_REQUEST_END
  [110, 84],  // FILE_TRANSFER_PROTOCOL
  [2, 137],     // SYSTEM_TIME
  [32, 185],    // LOCAL_POSITION_NED
  [82, 49],     // SET_ATTITUDE_TARGET
  [86, 5],      // SET_POSITION_TARGET_GLOBAL_INT
  [111, 34],    // TIMESYNC
  [245, 130],   // EXTENDED_SYS_STATE
  [251, 170],   // NAMED_VALUE_FLOAT
  [252, 44],    // NAMED_VALUE_INT
  [254, 46],    // DEBUG
  [263, 133],   // CAMERA_IMAGE_CAPTURED
  [285, 137],   // GIMBAL_DEVICE_ATTITUDE_STATUS
  [330, 23],    // OBSTACLE_DISTANCE
  [160, 78],    // FENCE_POINT
  [161, 68],    // FENCE_FETCH_POINT
  [70, 124],    // RC_CHANNELS_OVERRIDE
  [112, 174],   // CAMERA_TRIGGER
  [230, 163],   // ESTIMATOR_STATUS
  [27, 144],    // RAW_IMU
  [105, 93],    // HIGHRES_IMU
  [116, 76],    // SCALED_IMU2
  [129, 46],    // SCALED_IMU3
  [35, 244],    // RC_CHANNELS_RAW
  [39, 254],    // MISSION_ITEM
  [141, 47],    // ALTITUDE
  [231, 105],   // WIND_COV
  [301, 243],   // AIS_VESSEL
  [280, 70],    // GIMBAL_MANAGER_INFORMATION
  [281, 48],    // GIMBAL_MANAGER_STATUS
  [386, 132],   // CAN_FRAME
  [387, 4],     // CANFD_FRAME
  [388, 8],     // CAN_FILTER_MODIFY
  [100, 175],   // OPTICAL_FLOW
  [106, 138],   // OPTICAL_FLOW_RAD
  [102, 158],   // VISION_POSITION_ESTIMATE
  [331, 91],    // ODOMETRY
  [11011, 106], // VISION_POSITION_DELTA
  [397, 182],   // COMPONENT_METADATA
  [410, 160],   // EVENT
]);

/**
 * Expected payload lengths for known messages.
 * Used to restore zero-trimmed payloads to their canonical size.
 */
export const PAYLOAD_LENGTHS: ReadonlyMap<number, number> = new Map([
  [0, 9],     // HEARTBEAT
  [1, 31],    // SYS_STATUS
  [11, 6],    // SET_MODE
  [20, 20],   // PARAM_REQUEST_READ
  [21, 2],    // PARAM_REQUEST_LIST
  [22, 25],   // PARAM_VALUE
  [23, 23],   // PARAM_SET
  [24, 52],   // GPS_RAW_INT (30 base + alt_ellipsoid/h_acc/v_acc/vel_acc/hdg_acc/yaw extensions)
  [30, 28],   // ATTITUDE
  [33, 28],   // GLOBAL_POSITION_INT
  [41, 4],    // MISSION_SET_CURRENT
  [40, 5],    // MISSION_REQUEST (4 base + 1 missionType extension)
  [48, 21],   // SET_GPS_GLOBAL_ORIGIN (13 base + 8 time_usec extension)
  [44, 5],    // MISSION_COUNT (4 base + 1 missionType extension)
  [47, 4],    // MISSION_ACK (3 base + 1 missionType extension)
  [51, 5],    // MISSION_REQUEST_INT (4 base + 1 missionType extension)
  [65, 42],   // RC_CHANNELS
  [69, 11],   // MANUAL_CONTROL
  [73, 38],   // MISSION_ITEM_INT (37 base + 1 missionType extension)
  [74, 20],   // VFR_HUD
  [75, 35],   // COMMAND_INT
  [76, 33],   // COMMAND_LONG
  [77, 10],   // COMMAND_ACK (3 base + progress/result_param2/target_system/target_component)
  [126, 79],  // SERIAL_CONTROL
  [147, 54],  // BATTERY_STATUS (36 base + time_remaining/charge_state/voltages_ext/mode/fault_bitmask)
  [253, 54],  // STATUSTEXT (severity + 50 chars + 3 id bytes)
  [42, 2],    // MISSION_CURRENT
  [43, 3],    // MISSION_REQUEST_LIST (2 base + 1 missionType extension)
  [45, 3],    // MISSION_CLEAR_ALL (2 base + 1 missionType extension)
  [46, 2],    // MISSION_ITEM_REACHED
  [109, 9],   // RADIO_STATUS
  [36, 21],   // SERVO_OUTPUT_RAW
  [136, 22],  // TERRAIN_REPORT
  [168, 12],  // WIND
  [191, 27],  // MAG_CAL_PROGRESS
  [192, 54],  // MAG_CAL_REPORT (with orientation/scale extensions)
  [241, 32],  // VIBRATION
  [193, 26],  // EKF_STATUS_REPORT (22 base + airspeed_variance extension)
  [66, 6],    // REQUEST_DATA_STREAM
  [242, 52],  // HOME_POSITION (base, without time_usec extension)
  [148, 60],  // AUTOPILOT_VERSION (base, without uid2 extension)
  [125, 6],   // POWER_STATUS
  [132, 39],  // DISTANCE_SENSOR (14 base + horizontal_fov/vertical_fov/quaternion/signal_quality)
  [162, 8],   // FENCE_STATUS
  [62, 26],   // NAV_CONTROLLER_OUTPUT
  [26, 22],   // SCALED_IMU
  [29, 14],   // SCALED_PRESSURE
  [124, 35],  // GPS2_RAW
  [117, 6],   // LOG_REQUEST_LIST
  [118, 14],  // LOG_ENTRY
  [119, 12],  // LOG_REQUEST_DATA
  [120, 97],  // LOG_DATA
  [121, 2],   // LOG_ERASE
  [122, 2],   // LOG_REQUEST_END
  [110, 254], // FILE_TRANSFER_PROTOCOL (3 header + 251 payload)
  [2, 12],      // SYSTEM_TIME
  [32, 28],     // LOCAL_POSITION_NED
  [82, 39],     // SET_ATTITUDE_TARGET
  [86, 53],     // SET_POSITION_TARGET_GLOBAL_INT
  [111, 17],    // TIMESYNC
  [245, 2],     // EXTENDED_SYS_STATE
  [251, 18],    // NAMED_VALUE_FLOAT
  [252, 18],    // NAMED_VALUE_INT
  [254, 9],     // DEBUG
  [263, 255],   // CAMERA_IMAGE_CAPTURED
  [285, 49],    // GIMBAL_DEVICE_ATTITUDE_STATUS
  [330, 158],   // OBSTACLE_DISTANCE
  [160, 12],    // FENCE_POINT
  [161, 6],     // FENCE_FETCH_POINT
  [70, 18],     // RC_CHANNELS_OVERRIDE
  [112, 24],    // CAMERA_TRIGGER
  [230, 42],    // ESTIMATOR_STATUS
  [27, 26],     // RAW_IMU
  [105, 62],    // HIGHRES_IMU
  [116, 22],    // SCALED_IMU2 (same layout as SCALED_IMU)
  [129, 22],    // SCALED_IMU3 (same layout as SCALED_IMU)
  [35, 22],     // RC_CHANNELS_RAW
  [39, 37],     // MISSION_ITEM
  [141, 32],    // ALTITUDE
  [231, 40],    // WIND_COV
  [301, 58],    // AIS_VESSEL
  [280, 33],    // GIMBAL_MANAGER_INFORMATION
  [281, 13],    // GIMBAL_MANAGER_STATUS
  [386, 16],    // CAN_FRAME
  [387, 72],    // CANFD_FRAME (8 header + 64 data bytes)
  [388, 37],    // CAN_FILTER_MODIFY (16 x uint16 ids + 5 bytes fields = 37)
  [100, 34],    // OPTICAL_FLOW (26 base + 8 flow rate extension)
  [106, 44],    // OPTICAL_FLOW_RAD
  [102, 117],   // VISION_POSITION_ESTIMATE (32 base + 84 covariance + 1 resetCounter extension)
  [331, 233],   // ODOMETRY (232 base + 1 quality extension)
  [11011, 44],  // VISION_POSITION_DELTA
  [397, 108],   // COMPONENT_METADATA (4 time_boot_ms + 4 file_crc + 100 uri)
  [410, 53],    // EVENT (4 id + 4 time_boot_ms + 2 sequence + 3 x uint8 + 40 arguments)
]);
