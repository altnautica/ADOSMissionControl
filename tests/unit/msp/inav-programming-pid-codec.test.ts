/**
 * MSP2_INAV_SET_PROGRAMMING_PID is refused unless it is exactly 20 bytes:
 * index, enabled, setpoint (type U8 + S32), measurement (type U8 + S32), and
 * U16 P/I/D/FF. The read reply is the same record without the index.
 */

import { describe, expect, it } from 'vitest'
import { decodeMspINavProgrammingPid } from '@/lib/protocol/msp/msp-decoders-inav'
import { encodeMspINavSetProgrammingPid } from '@/lib/protocol/msp/msp-encoders-inav'

describe('iNav programming PID frame', () => {
  it('writes the 20-byte frame and reads it back', () => {
    const rule = {
      enabled: true,
      setpointType: 5, setpointValue: -1200,
      measurementType: 2, measurementValue: 70000,
      gains: { P: 300, I: 1000, D: 5, FF: 2000 },
    }
    const frame = encodeMspINavSetProgrammingPid(2, rule)
    expect(frame.length).toBe(20)
    expect(frame[0]).toBe(2)
    const reply = frame.slice(1)
    const [decoded] = decodeMspINavProgrammingPid(new DataView(reply.buffer, reply.byteOffset, reply.byteLength))
    expect(decoded).toMatchObject(rule)
  })
})
