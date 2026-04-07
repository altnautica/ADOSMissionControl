/**
 * Friendly decode hints for common CAN / DroneCAN / UAVCAN message IDs.
 *
 * This is a display-layer convenience map, not a full DSDL decoder. It
 * lets the CAN monitor label familiar message types (ESC telemetry, GPS
 * fix, airspeed, battery) without pulling in a full DroneCAN stack.
 *
 * Keys are the raw CAN identifier (11-bit or 29-bit). Matching is done
 * by extracting the DroneCAN data type ID bits from the 29-bit CAN ID
 * (bits 8..23 = data type ID).
 *
 * References:
 *   - https://dronecan.github.io/Specification/
 *   - https://github.com/DroneCAN/DSDL/tree/master/uavcan
 */

export interface CanIdHint {
  /** Short label shown in the monitor frame list. */
  label: string;
  /** Source node / device category. */
  source: string;
  /** Whether the frame is a broadcast message or a service call. */
  kind: "broadcast" | "service" | "unknown";
}

/**
 * DroneCAN data type IDs (16-bit) for commonly-used messages.
 *
 * These are the well-known IDs allocated by the DroneCAN specification.
 * A full decoder would cross-reference the message kind + priority bits,
 * but for monitor labeling the data type ID alone is enough.
 */
const DATA_TYPE_HINTS: Record<number, CanIdHint> = {
  // Node status / health
  341: { label: "NodeStatus", source: "DroneCAN", kind: "broadcast" },
  1: { label: "GetNodeInfo", source: "DroneCAN", kind: "service" },

  // ESC telemetry (uavcan.equipment.esc)
  1030: { label: "ESC Status", source: "ESC node", kind: "broadcast" },
  1031: { label: "ESC RPM", source: "ESC node", kind: "broadcast" },
  1034: { label: "ESC RawCommand", source: "Flight ctrl", kind: "broadcast" },

  // GPS / navigation (uavcan.equipment.gnss)
  1061: { label: "GNSS Fix2", source: "GPS node", kind: "broadcast" },
  1062: { label: "GNSS Auxiliary", source: "GPS node", kind: "broadcast" },

  // Air data (uavcan.equipment.air_data)
  1027: { label: "Airspeed", source: "Airspeed node", kind: "broadcast" },
  1028: { label: "Static Pressure", source: "Airspeed node", kind: "broadcast" },
  1029: { label: "Static Temperature", source: "Airspeed node", kind: "broadcast" },

  // Power (uavcan.equipment.power)
  1092: { label: "Battery Info", source: "Power node", kind: "broadcast" },
  1093: { label: "Primary Power", source: "Power node", kind: "broadcast" },

  // Compass (uavcan.equipment.ahrs)
  1002: { label: "Magnetic Field", source: "Compass node", kind: "broadcast" },

  // Rangefinder (uavcan.equipment.range_sensor)
  1050: { label: "Range Measurement", source: "Rangefinder", kind: "broadcast" },

  // Actuator
  1010: { label: "Actuator Status", source: "Actuator", kind: "broadcast" },
};

/**
 * Extract the DroneCAN data type ID from a 29-bit CAN identifier.
 * Bits 8..23 are the data type ID for message frames.
 */
function extractDataTypeId(canId: number): number {
  return (canId >>> 8) & 0xffff;
}

/** Look up a friendly label for a CAN ID. Returns null if unknown. */
export function getCanIdHint(canId: number): CanIdHint | null {
  const dataTypeId = extractDataTypeId(canId);
  return DATA_TYPE_HINTS[dataTypeId] ?? null;
}

/** Known data type IDs — exposed so callers can build dropdown filters. */
export const KNOWN_DATA_TYPE_IDS = Object.keys(DATA_TYPE_HINTS).map(Number);
