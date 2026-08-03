/**
 * PX4 ignores the legacy REQUEST_DATA_STREAM and drives per-message rates via
 * SET_MESSAGE_INTERVAL (COMMAND_LONG 511), so requestDataStreams must send one
 * COMMAND_LONG per telemetry message for PX4, and the legacy stream requests for
 * ArduPilot.
 *
 * @license GPL-3.0-only
 */
import { describe, it, expect } from 'vitest'
import { requestDataStreams } from '../../../src/lib/protocol/mavlink-adapter-frame-handlers'
import { createFirmwareHandlerByType } from '../../../src/lib/protocol/firmware/ardupilot'
import type { FirmwareType } from '../../../src/lib/protocol/types'

function streamCtx(firmwareType: FirmwareType) {
  const sent: Uint8Array[] = []
  const s = {
    // canCommand: a direct link, so stream requests can actually be delivered.
    // Housekeeping is skipped on a link that cannot carry a command.
    transport: {
      isConnected: true,
      canCommand: true,
      send: (f: Uint8Array) => sent.push(f),
    },
    firmwareHandler: createFirmwareHandlerByType(firmwareType),
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
  } as unknown as Parameters<typeof requestDataStreams>[0]
  return { s, sent }
}

/** MAVLink v2 msgId is bytes 7-9 (little-endian 24-bit). */
function msgIdOf(frame: Uint8Array): number {
  return frame[7] | (frame[8] << 8) | (frame[9] << 16)
}

describe('requestDataStreams', () => {
  it('sends per-message COMMAND_LONG (SET_MESSAGE_INTERVAL) for PX4', () => {
    const { s, sent } = streamCtx('px4')
    requestDataStreams(s)
    // One COMMAND_LONG (msg 76) per PX4 telemetry message.
    expect(sent.length).toBeGreaterThanOrEqual(10)
    expect(sent.every((f) => msgIdOf(f) === 76)).toBe(true)
  })

  it('sends legacy REQUEST_DATA_STREAM (msg 66) for ArduPilot', () => {
    const { s, sent } = streamCtx('ardupilot-copter')
    requestDataStreams(s)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((f) => msgIdOf(f) === 66)).toBe(true)
  })

  it('sends nothing when the transport is disconnected', () => {
    const { s, sent } = streamCtx('px4')
    ;(s.transport as { isConnected: boolean }).isConnected = false
    requestDataStreams(s)
    expect(sent.length).toBe(0)
  })
})
