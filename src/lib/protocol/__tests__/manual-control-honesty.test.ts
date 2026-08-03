/**
 * @license GPL-3.0-only
 *
 * `manualControlHz` is read by the manual-control stream, so it is a statement
 * about traffic that will exist. Two ways it used to be false on an MSP link:
 * an adapter with no override at all reported 50 Hz, and an adapter whose
 * override refuses every frame reported its firmware handler's 50 Hz. Both
 * describe a stream that never reaches the wire.
 */

import { describe, it, expect } from 'vitest'

import { MSPAdapter } from '../msp-adapter'

/**
 * Put an adapter into a state a real connect would reach, without an MSP
 * handshake. The two fields are private; the point of the test is exactly the
 * relationship between them and the reported rate, so it reaches for them
 * rather than testing something adjacent.
 */
function withOverride(adapter: MSPAdapter, rcOverride: unknown, handlerHz: number | null) {
  const internals = adapter as unknown as {
    rcOverride: unknown
    firmwareHandler: { getCapabilities: () => { manualControlHz: number } } | null
  }
  internals.rcOverride = rcOverride
  internals.firmwareHandler =
    handlerHz === null
      ? null
      : ({ getCapabilities: () => ({ manualControlHz: handlerHz }) } as never)
}

describe('MSP adapter manual-control rate', () => {
  it('reports no rate before there is an override to send through', () => {
    // Nothing is transmitted on an adapter that never connected, so a rate
    // here would describe traffic that cannot exist.
    expect(new MSPAdapter().getCapabilities().manualControlHz).toBe(0)
  })

  it('reports no rate when the override refuses every frame', () => {
    const adapter = new MSPAdapter()
    withOverride(adapter, { blockedReason: 'the receiver is not MSP' }, 50)
    expect(adapter.getCapabilities().manualControlHz).toBe(0)
  })

  it('reports no rate when no firmware handler declared one', () => {
    // The override would send, but nothing has said at what cadence. An
    // unknown flight controller is not assumed to take sticks — the generic
    // MAVLink handler declares the same 0 for the same reason.
    const adapter = new MSPAdapter()
    withOverride(adapter, { blockedReason: null }, null)
    expect(adapter.getCapabilities().manualControlHz).toBe(0)
  })

  it('reports the firmware handler rate when the override will send', () => {
    const adapter = new MSPAdapter()
    withOverride(adapter, { blockedReason: null }, 50)
    expect(adapter.getCapabilities().manualControlHz).toBe(50)
  })
})
