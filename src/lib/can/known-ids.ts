/**
 * Friendly decode hints for common DroneCAN message and service IDs.
 *
 * This is a display-layer convenience map, not a full DSDL decoder. It lets
 * the CAN monitor label familiar transfers (ESC commands and status, GNSS,
 * air data, power) without pulling in a full DroneCAN stack. Every type ID
 * comes from `DATA_TYPE_IDS`, the one table the GCS codecs also use.
 *
 * A 29-bit DroneCAN identifier is decoded before lookup:
 * - bit 7 set: a service frame, whose 8-bit service type ID sits in bits
 *   16..23 (bits 8..14 carry the destination node, bit 15 request/response);
 * - bit 7 clear, source node 0: an anonymous message, which carries only the
 *   low 2 bits of its type ID and so cannot be labelled;
 * - otherwise a message frame, whose 16-bit type ID sits in bits 8..23.
 *
 * References:
 *   - https://dronecan.github.io/Specification/
 *   - https://github.com/DroneCAN/DSDL/tree/master/uavcan
 */

import { DATA_TYPE_IDS } from "@/lib/dronecan/signatures";

export interface CanIdHint {
  /** Short label shown in the monitor frame list. */
  label: string;
  /** Source node / device category. */
  source: string;
  /** Whether the frame is a broadcast message or a service call. */
  kind: "broadcast" | "service";
}

const broadcast = (label: string, source: string): CanIdHint => ({
  label,
  source,
  kind: "broadcast",
});

/** Message broadcasts, keyed by 16-bit data type ID. */
const MESSAGE_HINTS: Record<number, CanIdHint> = {
  [DATA_TYPE_IDS.NodeStatus]: broadcast("NodeStatus", "DroneCAN"),
  [DATA_TYPE_IDS.EscRawCommand]: broadcast("ESC RawCommand", "Flight ctrl"),
  [DATA_TYPE_IDS.EscRPMCommand]: broadcast("ESC RPMCommand", "Flight ctrl"),
  [DATA_TYPE_IDS.EscStatus]: broadcast("ESC Status", "ESC node"),
  [DATA_TYPE_IDS.GnssFix2]: broadcast("GNSS Fix2", "GPS node"),
  [DATA_TYPE_IDS.GnssAuxiliary]: broadcast("GNSS Auxiliary", "GPS node"),
  [DATA_TYPE_IDS.GnssRtcmStream]: broadcast("GNSS RTCMStream", "Flight ctrl"),
  [DATA_TYPE_IDS.RawAirData]: broadcast("Raw Air Data", "Airspeed node"),
  [DATA_TYPE_IDS.StaticPressure]: broadcast("Static Pressure", "Airspeed node"),
  [DATA_TYPE_IDS.StaticTemperature]: broadcast("Static Temperature", "Airspeed node"),
  [DATA_TYPE_IDS.BatteryInfo]: broadcast("Battery Info", "Power node"),
  [DATA_TYPE_IDS.PrimaryPowerSupplyStatus]: broadcast("Primary Power Supply", "Power node"),
  [DATA_TYPE_IDS.MagneticFieldStrength2]: broadcast("Magnetic Field", "Compass node"),
  [DATA_TYPE_IDS.RangeSensorMeasurement]: broadcast("Range Measurement", "Rangefinder"),
  [DATA_TYPE_IDS.ActuatorArrayCommand]: broadcast("Actuator ArrayCommand", "Flight ctrl"),
  [DATA_TYPE_IDS.ActuatorStatus]: broadcast("Actuator Status", "Actuator"),
};

const service = (label: string): CanIdHint => ({ label, source: "DroneCAN", kind: "service" });

/** Services, keyed by 8-bit service type ID. */
const SERVICE_HINTS: Record<number, CanIdHint> = {
  [DATA_TYPE_IDS.GetNodeInfo]: service("GetNodeInfo"),
  [DATA_TYPE_IDS.GetTransportStats]: service("GetTransportStats"),
  [DATA_TYPE_IDS.RestartNode]: service("RestartNode"),
  [DATA_TYPE_IDS.paramGetSet]: service("param.GetSet"),
  [DATA_TYPE_IDS.paramExecuteOpcode]: service("param.ExecuteOpcode"),
  [DATA_TYPE_IDS.fileBeginFirmwareUpdate]: service("file.BeginFirmwareUpdate"),
  [DATA_TYPE_IDS.fileRead]: service("file.Read"),
};

/** Look up a friendly label for a 29-bit CAN ID. Returns null if unknown. */
export function getCanIdHint(canId: number): CanIdHint | null {
  if ((canId >>> 7) & 1) return SERVICE_HINTS[(canId >>> 16) & 0xff] ?? null;
  // An anonymous message carries only the low 2 bits of its type ID.
  if ((canId & 0x7f) === 0) return null;
  return MESSAGE_HINTS[(canId >>> 8) & 0xffff] ?? null;
}
