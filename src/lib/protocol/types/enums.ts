/**
 * Firmware and vehicle enum types.
 *
 * @module protocol/types/enums
 */

/** Autopilot firmware identifier derived from MAV_AUTOPILOT + MAV_TYPE. */
export type FirmwareType =
  | "ardupilot-copter"
  | "ardupilot-plane"
  | "ardupilot-rover"
  | "ardupilot-sub"
  | "px4"
  | "betaflight"
  | "inav"
  | "unknown";

/**
 * Unified flight mode — superset across all supported firmwares.
 *
 * The protocol adapter maps firmware-specific mode numbers to/from
 * this union so the UI never needs firmware-specific logic.
 */
export type UnifiedFlightMode =
  // Common
  | "STABILIZE"
  | "ACRO"
  | "ALT_HOLD"
  | "AUTO"
  | "GUIDED"
  | "LOITER"
  | "RTL"
  | "LAND"
  | "CIRCLE"
  | "POSHOLD"
  | "AUTOTUNE"
  | "MANUAL"
  // ArduPlane specific
  | "TRAINING"
  | "FBWA"
  | "FBWB"
  | "CRUISE"
  | "AVOID_ADSB"
  | "THERMAL"
  | "QSTABILIZE"
  | "QHOVER"
  | "QLOITER"
  | "QLAND"
  | "QRTL"
  | "QAUTOTUNE"
  | "QACRO"
  | "LOITER_TO_QLAND"
  | "AUTOLAND"
  // ArduCopter specific
  | "DRIFT"
  | "SPORT"
  | "FLIP"
  | "THROW"
  | "BRAKE"
  | "SMART_RTL"
  | "FLOWHOLD"
  | "FOLLOW"
  | "ZIGZAG"
  | "SYSTEMID"
  | "HELI_AUTOROTATE"
  | "AUTO_RTL"
  | "GUIDED_NOGPS"
  | "TURTLE"
  // ArduRover specific
  | "STEERING"
  | "HOLD"
  | "SIMPLE"
  | "DOCK"
  // ArduSub specific
  | "SURFACE"
  | "MOTOR_DETECT"
  | "SURFTRAK"
  // PX4
  | "OFFBOARD"
  | "RATTITUDE"
  | "MISSION"
  | "TAKEOFF"
  | "FOLLOW_ME"
  | "ORBIT"
  | "READY"
  | "PRECLAND"
  | "VTOL_TAKEOFF"
  // Generic
  | "UNKNOWN";

/** High-level vehicle class. */
export type VehicleClass = "copter" | "plane" | "rover" | "sub" | "vtol" | "unknown";

/** Accel cal position enum (matches ACCELCAL_VEHICLE_POS). */
export type AccelCalPosition = 1 | 2 | 3 | 4 | 5 | 6;
