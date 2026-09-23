/**
 * iNav mixer-family MSP2 codecs pinned against byte layouts written out from
 * the firmware's own serializers (fc_msp.c): MSP2_COMMON_MOTOR_MIXER,
 * MSP2_INAV_MIXER, MSP2_INAV_SERVO_CONFIG and MSP2_INAV_SERVO_MIXER. Every
 * fixture is literal wire bytes, never the output of the GCS encoder.
 */
import { describe, it, expect } from 'vitest'
import {
  encodeMspCommonSetMotorMixer,
  encodeMspINavSetServoConfig,
  encodeMspINavSetServoMixer,
} from '@/lib/protocol/msp/msp-encoders-inav'
import {
  decodeMspCommonMotorMixer,
  decodeMspINavMixer,
  decodeMspINavServoConfig,
  decodeMspINavServoMixer,
} from '@/lib/protocol/msp/msp-decoders-inav'

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer)

// Weights ride as u16 (weight + 2.0) x 1000: 1.0 -> 3000, 0 -> 2000, -1.0 -> 1000.
const W_POS1 = [0xb8, 0x0b]
const W_ZERO = [0xd0, 0x07]
const W_NEG1 = [0xe8, 0x03]
const EMPTY_SLOT = [...W_ZERO, ...W_ZERO, ...W_ZERO, ...W_ZERO]

describe('MSP2_COMMON_SET_MOTOR_MIXER encode', () => {
  it('offsets every weight by +2.0 before scaling', () => {
    const bytes = encodeMspCommonSetMotorMixer(0, { throttle: 1, roll: 0, pitch: 0, yaw: 0 })
    expect(Array.from(bytes)).toEqual([0x00, ...W_POS1, ...W_ZERO, ...W_ZERO, ...W_ZERO])
    const u16 = new DataView(bytes.buffer)
    expect([1, 3, 5, 7].map((o) => u16.getUint16(o, true))).toEqual([3000, 2000, 2000, 2000])
  })

  it('encodes a rear-right Quad X rule into slot 3', () => {
    const bytes = encodeMspCommonSetMotorMixer(3, { throttle: 1, roll: -1, pitch: 1, yaw: -1 })
    expect(Array.from(bytes)).toEqual([0x03, ...W_POS1, ...W_NEG1, ...W_POS1, ...W_NEG1])
  })

  it('clamps weights to the range the FC stores', () => {
    const bytes = encodeMspCommonSetMotorMixer(0, { throttle: 3, roll: -2.5, pitch: 0, yaw: 0 })
    const u16 = new DataView(bytes.buffer)
    expect([1, 3].map((o) => u16.getUint16(o, true))).toEqual([4000, 0])
  })
})

describe('MSP2_COMMON_MOTOR_MIXER decode', () => {
  // Quad X as the FC reports it: four rules, then empty slots up to MAX_SUPPORTED_MOTORS.
  const quadX = [
    ...W_POS1, ...W_NEG1, ...W_POS1, ...W_NEG1, // rear right
    ...W_POS1, ...W_NEG1, ...W_NEG1, ...W_POS1, // front right
    ...W_POS1, ...W_POS1, ...W_POS1, ...W_POS1, // rear left
    ...W_POS1, ...W_POS1, ...W_NEG1, ...W_NEG1, // front left
    ...Array.from({ length: 8 }, () => EMPTY_SLOT).flat(),
  ]

  it('removes the +2.0 offset and stops at the first empty slot', () => {
    expect(decodeMspCommonMotorMixer(dv(quadX))).toEqual([
      { throttle: 1, roll: -1, pitch: 1, yaw: -1 },
      { throttle: 1, roll: -1, pitch: -1, yaw: 1 },
      { throttle: 1, roll: 1, pitch: 1, yaw: 1 },
      { throttle: 1, roll: 1, pitch: -1, yaw: -1 },
    ])
  })

  it('ignores rules after the first empty slot, as the FC does', () => {
    const bytes = [...quadX.slice(0, 8), ...EMPTY_SLOT, ...quadX.slice(8, 16)]
    expect(decodeMspCommonMotorMixer(dv(bytes))).toHaveLength(1)
  })

  it('reads fractional weights exactly', () => {
    // 1500 -> -0.5, 2707 -> 0.707
    const bytes = [...W_POS1, 0xdc, 0x05, 0x93, 0x0a, ...W_ZERO]
    expect(decodeMspCommonMotorMixer(dv(bytes))).toEqual([{ throttle: 1, roll: -0.5, pitch: 0.707, yaw: 0 }])
  })
})

describe('MSP2_INAV_MIXER decode', () => {
  // motorDirectionInverted 0, reserved 0, motorstopOnLow 1, platformType 1 (airplane),
  // hasFlaps 1, appliedMixerPreset 14, MAX_SUPPORTED_MOTORS 12, MAX_SUPPORTED_SERVOS 18.
  const plane = [0x00, 0x00, 0x01, 0x01, 0x01, 0x0e, 0x00, 0x0c, 0x12]

  it('reads each field at its firmware offset', () => {
    expect(decodeMspINavMixer(dv(plane))).toEqual({
      motorDirectionInverted: false,
      motorstopOnLow: true,
      platformType: 1,
      hasFlaps: true,
      appliedMixerPreset: 14,
      maxSupportedMotors: 12,
      maxSupportedServos: 18,
    })
  })

  it('reads the motor direction flag from byte 0, not the platform', () => {
    const inverted = [0x01, ...plane.slice(1)]
    const mixer = decodeMspINavMixer(dv(inverted))
    expect(mixer.motorDirectionInverted).toBe(true)
    expect(mixer.platformType).toBe(1)
  })
})

describe('MSP2_INAV_SERVO_CONFIG', () => {
  // Per slot: u16 min, u16 max, u16 middle, s8 rate.
  const twoServos = [
    0xe8, 0x03, 0xd0, 0x07, 0xdc, 0x05, 0x64, // 1000 / 2000 / 1500, rate 100
    0x4c, 0x04, 0x6c, 0x07, 0xf0, 0x05, 0x9c, // 1100 / 1900 / 1520, rate -100
  ]

  it('decodes 7-byte slots', () => {
    expect(decodeMspINavServoConfig(dv(twoServos))).toEqual([
      { min: 1000, max: 2000, middle: 1500, rate: 100 },
      { min: 1100, max: 1900, middle: 1520, rate: -100 },
    ])
  })

  it('encodes the 8-byte SET frame the FC requires', () => {
    const bytes = encodeMspINavSetServoConfig(1, { min: 1100, max: 1900, middle: 1520, rate: -100 })
    expect(Array.from(bytes)).toEqual([0x01, ...twoServos.slice(7)])
  })
})

describe('MSP2_INAV_SERVO_MIXER', () => {
  it('decodes 6-byte rules', () => {
    // target 3, input 2, rate -50, speed 5, conditionId 9
    expect(decodeMspINavServoMixer(dv([0x03, 0x02, 0xce, 0xff, 0x05, 0x09]))).toEqual([
      { targetChannel: 3, inputSource: 2, rate: -50, speed: 5, conditionId: 9 },
    ])
  })

  it('encodes the 7-byte SET frame', () => {
    const bytes = encodeMspINavSetServoMixer(5, { targetChannel: 3, inputSource: 2, rate: -50, speed: 5, conditionId: 9 })
    expect(Array.from(bytes)).toEqual([0x05, 0x03, 0x02, 0xce, 0xff, 0x05, 0x09])
  })
})
