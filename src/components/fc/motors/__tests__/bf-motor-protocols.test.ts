/**
 * @module fc/motors/bf-motor-protocols.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { ESC_PROTOCOLS, isDshotProtocol, usesPwmRate } from "../bf-motor-protocols";

/** `motorProtocolTypes_e` (drivers/motor_types.h), in declaration order. */
const FIRMWARE_ENUM: Array<[string, string]> = [
  ["MOTOR_PROTOCOL_PWM", "PWM"],
  ["MOTOR_PROTOCOL_ONESHOT125", "OneShot125"],
  ["MOTOR_PROTOCOL_ONESHOT42", "OneShot42"],
  ["MOTOR_PROTOCOL_MULTISHOT", "MultiShot"],
  ["MOTOR_PROTOCOL_BRUSHED", "Brushed"],
  ["MOTOR_PROTOCOL_DSHOT150", "DShot150"],
  ["MOTOR_PROTOCOL_DSHOT300", "DShot300"],
  ["MOTOR_PROTOCOL_DSHOT600", "DShot600"],
  ["MOTOR_PROTOCOL_PROSHOT1000", "ProShot1000"],
  ["MOTOR_PROTOCOL_DISABLED", "Disabled (no motor output)"],
  ["MOTOR_PROTOCOL_DRONECAN", "DroneCAN"],
];

describe("Betaflight motor protocols", () => {
  it("labels every firmware protocol at its enum value", () => {
    expect(ESC_PROTOCOLS.map((p) => [Number(p.value), p.label])).toEqual(
      FIRMWARE_ENUM.map(([, label], i) => [i, label]),
    );
  });

  it("treats only DShot150/300/600 as DShot", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(isDshotProtocol)).toEqual([5, 6, 7]);
  });

  it("shows the PWM rate for PWM, OneShot, MultiShot and brushed", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(usesPwmRate)).toEqual([0, 1, 2, 3, 4]);
  });
});
