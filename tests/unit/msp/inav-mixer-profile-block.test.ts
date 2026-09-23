/**
 * On an iNav build with two mixer profiles, the motor and servo mixer replies
 * carry this profile's slots followed by the other profile's. The table sizes
 * come from MSP2_INAV_MIXER (MAX_SUPPORTED_MOTORS, MAX_SUPPORTED_SERVOS), so a
 * read shows only this profile's rules and a write covers exactly its slots.
 */

import { describe, expect, it } from 'vitest'
import {
  inavDownloadMotorMixer, inavDownloadServoMixer, inavUploadMotorMixer, inavUploadServoMixer,
} from '@/lib/protocol/msp-adapter/inav/mixer'
import { INAV_MSP } from '@/lib/protocol/msp/msp-decoders-inav'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'

const MOTORS = 12
const SERVOS = 18
const SERVO_RULES = 2 * SERVOS

function motorRecord(throttle: number): number[] {
  // Each weight is (w + 2) * 1000 as U16.
  const w = (v: number) => { const u = Math.round((v + 2) * 1000); return [u & 0xff, u >> 8] }
  return [...w(throttle), ...w(-1), ...w(1), ...w(-1)]
}

function servoRecord(rate: number): number[] {
  return [3, 1, rate & 0xff, (rate >> 8) & 0xff, 0, 0xff]
}

function twoProfileFc() {
  const sent: Array<{ cmd: number; payload: number[] }> = []
  const mixer = new Uint8Array(9)
  mixer[7] = MOTORS
  mixer[8] = SERVOS
  // This profile: 4 motors and 2 servo rules; the other profile is full.
  const motors = [
    ...Array.from({ length: MOTORS }, (_, i) => motorRecord(i < 4 ? 1 : 0)),
    ...Array.from({ length: MOTORS }, () => motorRecord(1)),
  ].flat()
  const servos = [
    ...Array.from({ length: SERVO_RULES }, (_, i) => servoRecord(i < 2 ? 100 : 0)),
    ...Array.from({ length: SERVO_RULES }, () => servoRecord(50)),
  ].flat()
  const replies: Record<number, Uint8Array> = {
    [INAV_MSP.MSP2_INAV_MIXER]: mixer,
    [INAV_MSP.MSP2_COMMON_MOTOR_MIXER]: new Uint8Array(motors),
    [INAV_MSP.MSP2_INAV_SERVO_MIXER]: new Uint8Array(servos),
  }
  const queue = {
    send: async (cmd: number, payload?: Uint8Array) => {
      sent.push({ cmd, payload: Array.from(payload ?? []) })
      return { command: cmd, payload: replies[cmd] ?? new Uint8Array(0) }
    },
  } as unknown as MspSerialQueue
  return { queue, sent }
}

describe('iNav mixer tables on a two-profile build', () => {
  it('reads only this profile\'s rules', async () => {
    const { queue } = twoProfileFc()
    expect(await inavDownloadMotorMixer(queue)).toHaveLength(4)
    const servos = await inavDownloadServoMixer(queue)
    expect(servos).toHaveLength(2)
    expect(servos[0]).toMatchObject({ targetChannel: 3, rate: 100, conditionId: -1 })
  })

  it('writes exactly this profile\'s slots, emptying the ones past the last rule', async () => {
    const { queue, sent } = twoProfileFc()
    await inavUploadMotorMixer(queue, [{ throttle: 1, roll: 0, pitch: 0, yaw: 0 }])
    await inavUploadServoMixer(queue, [{ targetChannel: 2, inputSource: 0, rate: 100, speed: 0, conditionId: -1 }])
    const motorSlots = sent.filter((s) => s.cmd === INAV_MSP.MSP2_COMMON_SET_MOTOR_MIXER).map((s) => s.payload[0])
    const servoFrames = sent.filter((s) => s.cmd === INAV_MSP.MSP2_INAV_SET_SERVO_MIXER)
    expect(motorSlots).toEqual(Array.from({ length: MOTORS }, (_, i) => i))
    expect(servoFrames.map((s) => s.payload[0])).toEqual(Array.from({ length: SERVO_RULES }, (_, i) => i))
    // Every slot past the rule is written with rate 0, the FC's end marker.
    expect(servoFrames.slice(1).every((s) => s.payload[3] === 0 && s.payload[4] === 0)).toBe(true)
  })

  it('refuses more rules than the FC has slots', async () => {
    const { queue } = twoProfileFc()
    const tooMany = Array.from({ length: MOTORS + 1 }, () => ({ throttle: 1, roll: 0, pitch: 0, yaw: 0 }))
    await expect(inavUploadMotorMixer(queue, tooMany)).rejects.toThrow(/12 motor mixer slots/)
  })
})
