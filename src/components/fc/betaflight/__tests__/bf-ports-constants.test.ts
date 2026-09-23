/**
 * @module fc/betaflight/bf-ports-constants.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { bfPortLabel, BF_SERIAL_FUNCTIONS, BF_SERIAL_FUNCTIONS_EXTENDED, BF_BAUD_RATES } from "../bf-ports-constants";

describe("bfPortLabel", () => {
  it("labels the legacy identifiers (firmware up to 4.5: USART1 = 0)", () => {
    expect(bfPortLabel(0)).toBe("UART1");
    expect(bfPortLabel(2)).toBe("UART3");
    expect(bfPortLabel(9)).toBe("UART10");
  });

  it("labels the current identifiers (UART_FIRST = 50, PIOUART_FIRST = 70)", () => {
    expect(bfPortLabel(20)).toBe("USB VCP");
    expect(bfPortLabel(30)).toBe("SOFTSERIAL1");
    expect(bfPortLabel(31)).toBe("SOFTSERIAL2");
    expect(bfPortLabel(40)).toBe("LPUART1");
    expect(bfPortLabel(50)).toBe("UART0");
    expect(bfPortLabel(51)).toBe("UART1");
    expect(bfPortLabel(58)).toBe("UART8");
    expect(bfPortLabel(65)).toBe("UART15");
    expect(bfPortLabel(70)).toBe("PIOUART0");
    expect(bfPortLabel(79)).toBe("PIOUART9");
  });
});

describe("BF serial function bits (io/serial.h serialPortFunction_e)", () => {
  // FUNCTION_* = 1 << bit, written out from the firmware enum. Bit 8 is unused.
  const FIRMWARE_BITS: Record<number, string> = {
    0: "MSP", 1: "GPS", 2: "FrSky Hub telemetry", 3: "HoTT telemetry", 4: "LTM telemetry",
    5: "SmartPort telemetry", 6: "Serial RX", 7: "Blackbox", 9: "MAVLink telemetry",
    10: "ESC sensor", 11: "VTX (SmartAudio)", 12: "IBUS telemetry", 13: "VTX (Tramp)",
    14: "RCDevice", 15: "LIDAR", 16: "FrSky OSD", 17: "VTX (MSP)", 18: "Gimbal", 19: "Custom OSD text",
  };

  it("maps every bit to its firmware function", () => {
    const table = Object.fromEntries(
      [...BF_SERIAL_FUNCTIONS, ...BF_SERIAL_FUNCTIONS_EXTENDED].map((f) => [f.bit, f.label]),
    );
    expect(table).toEqual(FIRMWARE_BITS);
  });

  it("keeps the legacy table inside the U16 mask", () => {
    for (const fn of BF_SERIAL_FUNCTIONS) expect(fn.bit).toBeLessThanOrEqual(15);
  });
});

describe("BF baud index table (io/serial.c baudRates)", () => {
  it("matches baudRate_e order", () => {
    expect(BF_BAUD_RATES).toEqual([
      "Auto", "9600", "19200", "38400", "57600", "115200", "230400", "250000",
      "400000", "460800", "500000", "921600", "1000000", "1500000", "2000000", "2470000",
    ]);
  });
});
