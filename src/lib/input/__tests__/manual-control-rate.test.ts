/**
 * @license GPL-3.0-only
 *
 * The manual-control stream used to transmit at a hardcoded 50 Hz while every
 * firmware handler and both adapters declared a `manualControlHz` nothing
 * read. A declared rate that no sender honours is not a rate, and a sender
 * that ignores a declared 0 transmits into a link that says it will discard
 * the frames.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { useInputStore } from '@/stores/input-store'

let protocol: unknown = null

vi.mock('@/stores/drone-manager', () => ({
  useDroneManager: { getState: () => ({ getSelectedProtocol: () => protocol }) },
}))

vi.mock('@/stores/drone-store', () => ({
  useDroneStore: { getState: () => ({ armState: 'armed', flightMode: 'STABILIZE' }) },
}))

const { manualControlTick, manualControlPeriodMs, stopManualControlStream } =
  await import('../gamepad-poller')

interface FakeProtocol {
  isConnected: boolean
  sendManualControl: ReturnType<typeof vi.fn>
  getCapabilities: () => { manualControlHz: number }
}

function fakeProtocol(hz: number): FakeProtocol {
  return {
    isConnected: true,
    sendManualControl: vi.fn(),
    getCapabilities: () => ({ manualControlHz: hz }),
  }
}

describe('manualControlPeriodMs', () => {
  it('turns a declared rate into a gap between frames', () => {
    expect(manualControlPeriodMs(50)).toBe(20)
    expect(manualControlPeriodMs(25)).toBe(40)
  })

  it('refuses to invent a rate the link did not declare', () => {
    expect(manualControlPeriodMs(0)).toBeNull()
    expect(manualControlPeriodMs(-50)).toBeNull()
    expect(manualControlPeriodMs(Number.NaN)).toBeNull()
  })
})

describe('manual-control stream cadence', () => {
  beforeEach(() => {
    protocol = null
    const s = useInputStore.getState()
    s.setController('gamepad')
    s.setManualControlEnabled(true)
    s.setAxes([0, 0, 0, 0])
  })

  afterEach(() => {
    stopManualControlStream()
    useInputStore.getState().resetInput()
  })

  it('transmits at the rate the link declares', () => {
    const p = fakeProtocol(50)
    protocol = p

    expect(manualControlTick()).toBe(20)
    expect(p.sendManualControl).toHaveBeenCalledTimes(1)
  })

  it('uses a slower link rate rather than a hardcoded one', () => {
    const p = fakeProtocol(10)
    protocol = p

    expect(manualControlTick()).toBe(100)
    expect(p.sendManualControl).toHaveBeenCalledTimes(1)
  })

  it('transmits nothing when the link declares no rate', () => {
    const p = fakeProtocol(0)
    protocol = p

    // The tick still returns, so the stream keeps re-checking and picks the
    // link up if it starts declaring a rate. It just puts nothing on the wire.
    expect(manualControlTick()).toBeGreaterThan(0)
    expect(p.sendManualControl).not.toHaveBeenCalled()
  })
})
