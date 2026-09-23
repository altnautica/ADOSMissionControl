/**
 * An iNav servo rule gated on logic condition -1 applies always; the firmware
 * resets rules to -1 and treats 0..63 as "only while that condition is true".
 * The wire byte is 255, so it has to survive a read and a write as -1.
 */

import { describe, expect, it } from 'vitest'
import { decodeMspINavServoMixer } from '@/lib/protocol/msp/msp-decoders-inav'
import { encodeMspINavSetServoMixer } from '@/lib/protocol/msp/msp-encoders-inav'

describe('iNav servo mixer condition', () => {
  it('writes -1 as 255 and reads 255 back as -1', () => {
    const rule = { targetChannel: 3, inputSource: 1, rate: -50, speed: 0, conditionId: -1 }
    const frame = encodeMspINavSetServoMixer(0, rule)
    expect(frame[6]).toBe(255)
    // The read reply is the frame without its slot index.
    const reply = frame.slice(1)
    expect(decodeMspINavServoMixer(new DataView(reply.buffer, reply.byteOffset, reply.byteLength))).toEqual([rule])
  })

  it('keeps a real logic condition id', () => {
    const rule = { targetChannel: 0, inputSource: 0, rate: 100, speed: 5, conditionId: 42 }
    const reply = encodeMspINavSetServoMixer(0, rule).slice(1)
    expect(decodeMspINavServoMixer(new DataView(reply.buffer, reply.byteOffset, reply.byteLength))[0].conditionId).toBe(42)
  })
})
