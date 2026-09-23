/**
 * Betaflight serial-port constants: the serial function bits, the baud-rate
 * index table, and a port-identifier label. Functions 0-15 fit the legacy
 * MSP_CF_SERIAL_CONFIG U16 mask; functions 16-19 (FrSky OSD, VTX MSP, gimbal,
 * custom OSD text) need the 32-bit MSP2_COMMON_SERIAL_CONFIG mask.
 *
 * @module fc/betaflight/bf-ports-constants
 */

// Exempt from 300 LOC soft rule: protocol data table.

/** Serial function bits 0-15 (representable in the legacy U16 mask). */
export const BF_SERIAL_FUNCTIONS: ReadonlyArray<{ bit: number; label: string }> = [
  { bit: 0, label: "MSP" },
  { bit: 1, label: "GPS" },
  { bit: 2, label: "FrSky Hub telemetry" },
  { bit: 3, label: "HoTT telemetry" },
  { bit: 4, label: "LTM telemetry" },
  { bit: 5, label: "SmartPort telemetry" },
  { bit: 6, label: "Serial RX" },
  { bit: 7, label: "Blackbox" },
  { bit: 9, label: "MAVLink telemetry" },
  { bit: 10, label: "ESC sensor" },
  { bit: 11, label: "VTX (SmartAudio)" },
  { bit: 12, label: "IBUS telemetry" },
  { bit: 13, label: "VTX (Tramp)" },
  { bit: 14, label: "RCDevice" },
  { bit: 15, label: "LIDAR" },
];

/**
 * Serial function bits 16-19 — reachable only via the 32-bit MSP2 serial
 * config. Shown only when the FC speaks MSP2_COMMON_SERIAL_CONFIG.
 */
export const BF_SERIAL_FUNCTIONS_EXTENDED: ReadonlyArray<{ bit: number; label: string }> = [
  { bit: 16, label: "FrSky OSD" },
  { bit: 17, label: "VTX (MSP)" },
  { bit: 18, label: "Gimbal" },
  { bit: 19, label: "Custom OSD text" },
];

/** Baud-rate index → label; the MSP serial-config baud field is an index into this table. */
export const BF_BAUD_RATES: readonly string[] = [
  "Auto", "9600", "19200", "38400", "57600", "115200", "230400", "250000",
  "400000", "460800", "500000", "921600", "1000000", "1500000", "2000000", "2470000",
];

/**
 * Friendly label for a Betaflight serial-port identifier (io/serial.h
 * serialPortIdentifier_e). The two numbering schemes do not overlap:
 * firmware up to 4.5 numbers UART1..UART10 as 0..9; newer firmware numbers
 * UARTs from 50 (UART0 = 50, UART1 = 51) and PIO UARTs from 70.
 */
export function bfPortLabel(identifier: number): string {
  if (identifier >= 0 && identifier < 10) return `UART${identifier + 1}`;
  if (identifier === 20) return "USB VCP";
  if (identifier >= 30 && identifier < 40) return `SOFTSERIAL${identifier - 29}`;
  if (identifier >= 40 && identifier < 50) return `LPUART${identifier - 39}`;
  if (identifier >= 50 && identifier < 70) return `UART${identifier - 50}`;
  if (identifier >= 70 && identifier < 80) return `PIOUART${identifier - 70}`;
  return `Port ${identifier}`;
}
