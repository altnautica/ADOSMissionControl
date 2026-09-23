/**
 * Static data and data-producing functions for MockProtocol.
 *
 * Fence polygon, vehicle info constants, mission waypoints, and log entries.
 * Extracted to keep mock-protocol.ts under 300 lines.
 *
 * @license GPL-3.0-only
 */

import type { VehicleInfo, MissionItem, LogEntry } from "@/lib/protocol/types";

export const MOCK_HOME_LAT = 0.0;
export const MOCK_HOME_LON = 0.0;

/** 5-point polygon fence centered on mock home, ~200m radius. */
export const MOCK_FENCE_POLYGON: Array<{ idx: number; lat: number; lon: number }> = [
  { idx: 0, lat: MOCK_HOME_LAT + 0.0018,  lon: MOCK_HOME_LON },
  { idx: 1, lat: MOCK_HOME_LAT + 0.00056, lon: MOCK_HOME_LON + 0.00171 },
  { idx: 2, lat: MOCK_HOME_LAT - 0.00145, lon: MOCK_HOME_LON + 0.00106 },
  { idx: 3, lat: MOCK_HOME_LAT - 0.00145, lon: MOCK_HOME_LON - 0.00106 },
  { idx: 4, lat: MOCK_HOME_LAT + 0.00056, lon: MOCK_HOME_LON - 0.00171 },
];

export const MOCK_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-copter", vehicleClass: "copter",
  firmwareVersionString: "ArduCopter V4.5.7", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 2,
};

// Traditional helicopter: shares the "copter" class but reports MAV_TYPE
// HELICOPTER (4), which gates the heli config panel.
export const HELI_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-copter", vehicleClass: "copter",
  firmwareVersionString: "ArduCopter V4.5.7 (Heli)", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 4,
};

export const PX4_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "px4", vehicleClass: "copter",
  firmwareVersionString: "PX4 v1.15.0", systemId: 1, componentId: 1,
  autopilotType: 12, vehicleType: 2,
};

export const PX4_VTOL_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "px4", vehicleClass: "vtol",
  firmwareVersionString: "PX4 v1.15.0", systemId: 1, componentId: 1,
  autopilotType: 12, vehicleType: 22,
};

export const ARDUPLANE_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-plane", vehicleClass: "plane",
  firmwareVersionString: "ArduPlane V4.5.7", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 1,
};

export const ARDUSUB_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-sub", vehicleClass: "sub",
  firmwareVersionString: "ArduSub V4.5.7", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 12,
};

// QuadPlane / tailsitter / tiltrotor VTOLs all run ArduPlane firmware, so they
// classify as vehicleClass "plane" (that + supportsVtolConfig gate the VTOL/TECS
// panels); the MAV_TYPE distinguishes the VTOL variant.
export const ARDUPLANE_VTOL_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-plane", vehicleClass: "plane",
  firmwareVersionString: "ArduPlane V4.5.7 (QuadPlane)", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 22,   // MAV_TYPE_VTOL_FIXEDROTOR
};

export const ARDUPLANE_TAILSITTER_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-plane", vehicleClass: "plane",
  firmwareVersionString: "ArduPlane V4.5.7 (Tailsitter)", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 23,   // MAV_TYPE_VTOL_TAILSITTER
};

export const ARDUPLANE_TILTROTOR_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-plane", vehicleClass: "plane",
  firmwareVersionString: "ArduPlane V4.5.7 (Tiltrotor)", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 21,   // MAV_TYPE_VTOL_TILTROTOR
};

export const ARDUROVER_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-rover", vehicleClass: "rover",
  firmwareVersionString: "ArduRover V4.5.7", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 10,   // MAV_TYPE_GROUND_ROVER
};

export const ARDUBOAT_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "ardupilot-rover", vehicleClass: "rover",
  firmwareVersionString: "ArduRover V4.5.7 (Boat)", systemId: 1, componentId: 1,
  autopilotType: 3, vehicleType: 11,   // MAV_TYPE_SURFACE_BOAT
};

export const BETAFLIGHT_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "betaflight", vehicleClass: "copter",
  firmwareVersionString: "Betaflight 4.5.0 (MSP API 1.46)", systemId: 1, componentId: 1,
  autopilotType: 0, vehicleType: 2, mspApiVersion: { major: 1, minor: 46 },
};

export const INAV_FW_VEHICLE_INFO: VehicleInfo = {
  firmwareType: "inav", vehicleClass: "plane",
  firmwareVersionString: "INAV 7.1.2 (MSP API 2.5)", systemId: 1, componentId: 1,
  autopilotType: 0, vehicleType: 1, mspApiVersion: { major: 2, minor: 5 },
};

/**
 * 6 waypoints: TAKEOFF -> 4 waypoints -> LAND. With `homeSlot` the list uses the
 * ArduPilot layout: the home position at seq 0 and the mission from seq 1.
 */
export function getMockMission(homeSlot: boolean): MissionItem[] {
  const mission: MissionItem[] = [
    { seq: 0, frame: 3, command: 22, current: 1, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: Math.round(0.0 * 1e7), y: Math.round(0.0 * 1e7), z: 50 },
    { seq: 1, frame: 3, command: 16, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: Math.round(0.002 * 1e7), y: Math.round(0.002 * 1e7), z: 50 },
    { seq: 2, frame: 3, command: 16, current: 0, autocontinue: 1, param1: 5, param2: 0, param3: 0, param4: 0, x: Math.round(0.004 * 1e7), y: Math.round(0.0 * 1e7), z: 60 },
    { seq: 3, frame: 3, command: 16, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: Math.round(0.004 * 1e7), y: Math.round(-0.002 * 1e7), z: 60 },
    { seq: 4, frame: 3, command: 16, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: Math.round(0.002 * 1e7), y: Math.round(-0.002 * 1e7), z: 50 },
    { seq: 5, frame: 3, command: 21, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: Math.round(0.0 * 1e7), y: Math.round(0.0 * 1e7), z: 0 },
  ];
  if (!homeSlot) return mission;
  const home: MissionItem = { seq: 0, frame: 0, command: 16, current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0, z: 0 };
  return [home, ...mission.map((it) => ({ ...it, seq: it.seq + 1 }))];
}

export function getMockLogList(): LogEntry[] {
  const baseTime = Math.floor(Date.now() / 1000) - 86400;
  return [
    { id: 1, numLogs: 5, lastLogId: 5, size: 24576, timeUtc: baseTime - 86400 * 4 },
    { id: 2, numLogs: 5, lastLogId: 5, size: 51200, timeUtc: baseTime - 86400 * 3 },
    { id: 3, numLogs: 5, lastLogId: 5, size: 102400, timeUtc: baseTime - 86400 * 2 },
    { id: 4, numLogs: 5, lastLogId: 5, size: 32768, timeUtc: baseTime - 86400 },
    { id: 5, numLogs: 5, lastLogId: 5, size: 16384, timeUtc: baseTime },
  ];
}
