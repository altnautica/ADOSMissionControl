/**
 * Which link carries an outbound byte.
 *
 * The adapter picked its send target purely on byte recency, so the busiest
 * link won. A receive-only relay downlink pushing telemetry is easily the
 * busiest, and it discards everything written back — so every command aimed
 * at the link that dropped it while a commanding link sat idle beside it.
 *
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MAVLinkAdapter } from '../../../src/lib/protocol/mavlink-adapter'
import { buildFrame, resetSequences } from '../../../src/lib/protocol/encoders/frame'
import type { Transport, TransportEventMap } from '../../../src/lib/protocol/types'

/** ArduCopter heartbeat: type 2 (QUADROTOR), autopilot 3 (ArduPilotMega). */
function vehicleHeartbeat(sysId: number): Uint8Array {
  const payload = new Uint8Array(9)
  const dv = new DataView(payload.buffer)
  dv.setUint32(0, 0, true) // customMode = STABILIZE
  payload[4] = 2 // MAV_TYPE_QUADROTOR
  payload[5] = 3 // MAV_AUTOPILOT_ARDUPILOTMEGA
  payload[6] = 0 // baseMode, disarmed
  payload[7] = 3 // MAV_STATE_STANDBY
  payload[8] = 3
  return buildFrame(0, payload, sysId, 1)
}

class FakeTransport implements Transport {
  readonly type = 'websocket' as const
  isConnected = true
  readonly sent: Uint8Array[] = []
  private handlers = new Map<string, Set<(data: never) => void>>()

  constructor(readonly canCommand: boolean) {}

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.isConnected = false
  }

  send(data: Uint8Array): void {
    if (!this.canCommand) {
      // What a receive-only transport really does: the write is accepted by
      // the socket and dropped downstream, which is exactly why byte recency
      // was never a safe way to choose a send target.
      return
    }
    this.sent.push(data)
  }

  on<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    const set = this.handlers.get(event) ?? new Set()
    set.add(handler as (data: never) => void)
    this.handlers.set(event, set)
  }

  off<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    this.handlers.get(event)?.delete(handler as (data: never) => void)
  }

  /** Deliver inbound bytes, which is what advances this link's `lastByteAt`. */
  receive(data: Uint8Array): void {
    for (const handler of this.handlers.get('data') ?? []) {
      ;(handler as unknown as (d: Uint8Array) => void)(data)
    }
  }
}

/** Total frames written across the two links, ignoring the housekeeping ones. */
function commandFrames(t: FakeTransport): Uint8Array[] {
  // msgId sits at bytes 7..9 of a v2 frame; heartbeat is 0, and the adapter
  // emits one per second plus stream requests, which are not the subject here.
  return t.sent.filter((f) => !(f[7] === 0 && f[8] === 0 && f[9] === 0))
}

describe('outbound link selection', () => {
  beforeEach(() => {
    resetSequences()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function connectWith(primary: FakeTransport): Promise<MAVLinkAdapter> {
    const adapter = new MAVLinkAdapter()
    const connecting = adapter.connect(primary)
    primary.receive(vehicleHeartbeat(1))
    await connecting
    return adapter
  }

  it('sends over the commanding link even when a receive-only link is busier', async () => {
    const receiveOnly = new FakeTransport(false)
    const commanding = new FakeTransport(true)

    // The receive-only link is the one that answered the connect handshake,
    // which is the realistic case: telemetry arrives before the operator has
    // a command lane.
    const adapter = await connectWith(receiveOnly)
    const added = adapter.addLink(commanding)
    commanding.receive(vehicleHeartbeat(1))
    const result = await added
    expect(result.ok).toBe(true)

    // Now the relay keeps pushing telemetry, so it is unambiguously the most
    // recently active link.
    await vi.advanceTimersByTimeAsync(5)
    receiveOnly.receive(vehicleHeartbeat(1))

    const arm = adapter.arm()
    await vi.advanceTimersByTimeAsync(0)

    expect(commandFrames(commanding).length).toBeGreaterThan(0)
    expect(receiveOnly.sent).toHaveLength(0)

    // Nothing acked it, so let the pending command time out rather than
    // leaving an unhandled rejection behind.
    await vi.advanceTimersByTimeAsync(4000)
    await arm
    await adapter.disconnect()
  })

  it('keeps using the busiest link when both can command', async () => {
    const first = new FakeTransport(true)
    const second = new FakeTransport(true)

    const adapter = await connectWith(first)
    const added = adapter.addLink(second)
    second.receive(vehicleHeartbeat(1))
    expect((await added).ok).toBe(true)

    await vi.advanceTimersByTimeAsync(5)
    second.receive(vehicleHeartbeat(1))

    const before = commandFrames(first).length
    const arm = adapter.arm()
    await vi.advanceTimersByTimeAsync(0)

    // Recency still decides between two links that can both carry a command.
    expect(commandFrames(second).length).toBeGreaterThan(0)
    expect(commandFrames(first).length).toBe(before)

    await vi.advanceTimersByTimeAsync(4000)
    await arm
    await adapter.disconnect()
  })

  it('writes nothing when the only link cannot carry a command', async () => {
    const receiveOnly = new FakeTransport(false)
    const adapter = await connectWith(receiveOnly)

    // Falling back to the primary rather than null is deliberate: the guard
    // downstream then reads the real link state instead of claiming "Not
    // connected" about a link that is connected and simply cannot command.
    const arm = adapter.arm()
    await vi.advanceTimersByTimeAsync(0)
    expect(receiveOnly.sent).toHaveLength(0)

    // The queue times the unanswered command out rather than hanging.
    await vi.advanceTimersByTimeAsync(4000)
    expect((await arm).success).toBe(false)
    await adapter.disconnect()
  })
})
