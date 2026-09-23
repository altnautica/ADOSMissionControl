/**
 * @module serial-port-match.test
 * @description A saved serial link reopens only the port it used. With a
 * telemetry radio and a flight controller both permitted, reconnecting the
 * flight controller must never open the radio because it is listed first.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { matchKnownPort, type PortInfo } from "@/lib/serial-port-manager";

function port(label: string, vendorId?: number, productId?: number): PortInfo {
  return { port: {} as SerialPort, label, vendorId, productId };
}

const RADIO = port("SiK radio", 0x0403, 0x6015);
const FC = port("Flight controller", 0x1209, 0x5741);

describe("matchKnownPort", () => {
  it("reopens the port whose USB identity matches, not the first one", () => {
    expect(matchKnownPort([RADIO, FC], 0x1209, 0x5741)).toBe(FC);
  });

  it("returns null when the saved device is not present", () => {
    expect(matchKnownPort([RADIO], 0x1209, 0x5741)).toBeNull();
  });

  it("returns null when two identical adapters make the match ambiguous", () => {
    const twin = port("Second radio", 0x0403, 0x6015);
    expect(matchKnownPort([RADIO, twin], 0x0403, 0x6015)).toBeNull();
  });

  it("accepts the only permitted port when the link carries no USB identity", () => {
    expect(matchKnownPort([FC], undefined, undefined)).toBe(FC);
    expect(matchKnownPort([RADIO, FC], undefined, undefined)).toBeNull();
  });
});
