/**
 * MSP decoders — RC channels, motor outputs, and motor configuration.
 *
 * @module protocol/msp/msp-decoders-motor
 */

import { readU8, readU16 } from './msp-decode-utils';

// ── Types ────────────────────────────────────────────────────

export interface MspRc {
  channels: number[];
}

export interface MspMotor {
  motors: number[];
}

export interface MspMotorConfig {
  minThrottle: number;
  maxThrottle: number;
  minCommand: number;
  motorCount: number;
  motorPoles: number;
  useDshotTelemetry: boolean;
  useEscSensor: boolean;
}

// ── Decoders ─────────────────────────────────────────────────

/**
 * MSP_RC (105)
 * Variable length, each channel is U16 (1000-2000 range)
 */
export function decodeMspRc(dv: DataView): MspRc {
  const channelCount = dv.byteLength / 2;
  const channels: number[] = [];
  for (let i = 0; i < channelCount; i++) {
    channels.push(readU16(dv, i * 2));
  }
  return { channels };
}

/**
 * MSP_MOTOR (104)
 * Variable length, each motor value is U16
 */
export function decodeMspMotor(dv: DataView): MspMotor {
  const count = dv.byteLength / 2;
  const motors: number[] = [];
  for (let i = 0; i < count; i++) {
    motors.push(readU16(dv, i * 2));
  }
  return { motors };
}

/**
 * MSP_MOTOR_CONFIG (131)
 *   U16 minThrottle
 *   U16 maxThrottle
 *   U16 minCommand
 *   U8  motorCount
 *   U8  motorPoles
 *   U8  useDshotTelemetry
 *   U8  useEscSensor
 */
export function decodeMspMotorConfig(dv: DataView): MspMotorConfig {
  return {
    minThrottle: readU16(dv, 0),
    maxThrottle: readU16(dv, 2),
    minCommand: readU16(dv, 4),
    motorCount: readU8(dv, 6),
    motorPoles: readU8(dv, 7),
    useDshotTelemetry: readU8(dv, 8) !== 0,
    useEscSensor: readU8(dv, 9) !== 0,
  };
}
