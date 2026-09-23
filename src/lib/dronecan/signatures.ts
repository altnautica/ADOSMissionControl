/**
 * @module signatures
 * @description Precomputed 64-bit DSDL signatures and data type IDs for the
 * eight standard DroneCAN messages the GCS speaks. The signatures are used by
 * the transfer coder when computing the multi-frame CRC.
 * @license GPL-3.0-only
 */

/**
 * 64-bit DSDL signatures keyed by short name. Each value is the canonical
 * DSDL signature for the matching `uavcan.protocol.*` type.
 */
export const DSDL_SIGNATURES = {
  NodeStatus: BigInt("0x0F0868D0C1A7C6F1"),
  GetNodeInfo: BigInt("0xEE468A8121C46A9E"),
  paramGetSet: BigInt("0xA7B622F939D1A4D5"),
  paramExecuteOpcode: BigInt("0x3B131AC5EB69D2CD"),
  RestartNode: BigInt("0x569E05394A3017F0"),
  fileBeginFirmwareUpdate: BigInt("0xB7D725DF72724126"),
  fileRead: BigInt("0x8DCDCA939F33F678"),
  GetTransportStats: BigInt("0xBE6F76A7EC312B04"),
  EscRawCommand: BigInt("0x217F5C87D7EC951D"),
  GnssFix2: BigInt("0xCA41E7000F37435F"),
  MagneticFieldStrength2: BigInt("0xB6AC0C442430297E"),
} as const;

/**
 * DroneCAN data type IDs the GCS speaks or labels, from the DSDL definitions
 * (`uavcan/protocol`, `uavcan/equipment/*`). Message broadcasts use a 16-bit
 * type ID; services use an 8-bit type ID, so a message and a service may share
 * a number.
 */
export const DATA_TYPE_IDS = {
  /** Message broadcast `uavcan.protocol.NodeStatus` (16-bit). */
  NodeStatus: 341,
  /** Service `uavcan.protocol.GetNodeInfo` (8-bit). */
  GetNodeInfo: 1,
  /** Service `uavcan.protocol.param.GetSet` (8-bit). */
  paramGetSet: 11,
  /** Service `uavcan.protocol.param.ExecuteOpcode` (8-bit). */
  paramExecuteOpcode: 10,
  /** Service `uavcan.protocol.RestartNode` (8-bit). */
  RestartNode: 5,
  /** Service `uavcan.protocol.file.BeginFirmwareUpdate` (8-bit). */
  fileBeginFirmwareUpdate: 40,
  /** Service `uavcan.protocol.file.Read` (8-bit). */
  fileRead: 48,
  /** Service `uavcan.protocol.GetTransportStats` (8-bit). */
  GetTransportStats: 4,
  /** Message broadcast `uavcan.equipment.esc.RawCommand` (16-bit). */
  EscRawCommand: 1030,
  /** Message broadcast `uavcan.equipment.esc.RPMCommand` (16-bit). */
  EscRPMCommand: 1031,
  /** Message broadcast `uavcan.equipment.esc.Status` (16-bit). */
  EscStatus: 1034,
  /** Message broadcast `uavcan.equipment.gnss.Auxiliary` (16-bit). */
  GnssAuxiliary: 1061,
  /** Message broadcast `uavcan.equipment.gnss.RTCMStream` (16-bit). */
  GnssRtcmStream: 1062,
  /** Message broadcast `uavcan.equipment.gnss.Fix2` (16-bit). */
  GnssFix2: 1063,
  /** Message broadcast `uavcan.equipment.air_data.RawAirData` (16-bit). */
  RawAirData: 1027,
  /** Message broadcast `uavcan.equipment.air_data.StaticPressure` (16-bit). */
  StaticPressure: 1028,
  /** Message broadcast `uavcan.equipment.air_data.StaticTemperature` (16-bit). */
  StaticTemperature: 1029,
  /** Message broadcast `uavcan.equipment.power.PrimaryPowerSupplyStatus` (16-bit). */
  PrimaryPowerSupplyStatus: 1090,
  /** Message broadcast `uavcan.equipment.power.BatteryInfo` (16-bit). */
  BatteryInfo: 1092,
  /** Message broadcast `uavcan.equipment.ahrs.MagneticFieldStrength2` (16-bit). */
  MagneticFieldStrength2: 1002,
  /** Message broadcast `uavcan.equipment.range_sensor.Measurement` (16-bit). */
  RangeSensorMeasurement: 1050,
  /** Message broadcast `uavcan.equipment.actuator.ArrayCommand` (16-bit). */
  ActuatorArrayCommand: 1010,
  /** Message broadcast `uavcan.equipment.actuator.Status` (16-bit). */
  ActuatorStatus: 1011,
} as const;

export type DsdlSignatureName = keyof typeof DSDL_SIGNATURES;
