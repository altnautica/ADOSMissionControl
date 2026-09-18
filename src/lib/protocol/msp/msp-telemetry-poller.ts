/**
 * MSP telemetry poller.
 *
 * MSP is a request/response protocol (unlike MAVLink which streams).
 * This poller sends periodic MSP requests at configurable intervals
 * to maintain telemetry data flow.
 *
 * Three poll groups with different rates:
 * - fast (30ms): attitude, RC channels
 * - medium (100ms): battery, status, motors
 * - slow (500ms): IMU, altitude, GPS
 *
 * Includes adaptive backoff: if the serial queue has >5 pending
 * requests, that tick is skipped to avoid saturation.
 *
 * @module protocol/msp/msp-telemetry-poller
 */

import { MSP } from './msp-constants'
import { INAV_MSP } from './msp-decoders-inav'
import type { MspSerialQueue } from './msp-serial-queue'

// ── Types ──────────────────────────────────────────────────

export interface PollGroup {
  name: string
  commands: number[]
  intervalMs: number
}

interface ActiveGroup {
  group: PollGroup
  timerId: ReturnType<typeof setInterval> | null
}

// ── Queue saturation threshold ─────────────────────────────

const MAX_PENDING_BEFORE_SKIP = 5

// ── Default Poll Groups ────────────────────────────────────

function createDefaultGroups(): PollGroup[] {
  return [
    {
      name: 'fast',
      commands: [
        MSP.MSP_ATTITUDE,     // 108
        MSP.MSP_RC,           // 105
      ],
      intervalMs: 30,
    },
    {
      name: 'medium',
      commands: [
        MSP.MSP_ANALOG,       // 110
        MSP.MSP_STATUS_EX,    // 150
        MSP.MSP_MOTOR,        // 104
        MSP.MSP_BATTERY_STATE, // 130
      ],
      intervalMs: 100,
    },
    {
      name: 'slow',
      commands: [
        MSP.MSP_RAW_IMU,                    // 102
        MSP.MSP_ALTITUDE,                   // 109
        MSP.MSP_RAW_GPS,                    // 106
        INAV_MSP.MSP2_INAV_STATUS,          // 0x2000 iNav extended status
        INAV_MSP.MSP_NAV_STATUS,            // 121 iNav nav state / WP action
        INAV_MSP.MSP2_ADSB_VEHICLE_LIST,    // 0x2090 ADS-B traffic (2 Hz via slow-group 500 ms)
      ],
      intervalMs: 500,
    },
  ]
}

// ── Poller Class ───────────────────────────────────────────

export class MspTelemetryPoller {
  private activeGroups: Map<string, ActiveGroup> = new Map()
  private running = false

  constructor(
    private queue: MspSerialQueue,
    private onData: (command: number, payload: Uint8Array) => void,
  ) {}

  /** Start polling with default groups. */
  start(): void {
    if (this.running) return
    this.running = true

    const defaults = createDefaultGroups()
    for (const group of defaults) {
      this.startGroup(group)
    }
  }

  /** Stop all polling. */
  stop(): void {
    this.running = false

    for (const [, active] of this.activeGroups) {
      if (active.timerId !== null) {
        clearInterval(active.timerId)
        active.timerId = null
      }
    }
    this.activeGroups.clear()
  }

  /** Update poll rate for a group. */
  setPollRate(groupName: string, intervalMs: number): void {
    const active = this.activeGroups.get(groupName)
    if (!active) return

    active.group.intervalMs = intervalMs

    // Restart the interval with new rate
    if (active.timerId !== null) {
      clearInterval(active.timerId)
    }

    if (this.running) {
      active.timerId = setInterval(() => this.pollGroup(active.group), intervalMs)
    }
  }

  /** Add a command to a poll group. */
  addCommand(groupName: string, command: number): void {
    const active = this.activeGroups.get(groupName)
    if (!active) return

    if (!active.group.commands.includes(command)) {
      active.group.commands.push(command)
    }
  }

  /** Remove a command from a poll group. */
  removeCommand(groupName: string, command: number): void {
    const active = this.activeGroups.get(groupName)
    if (!active) return

    const idx = active.group.commands.indexOf(command)
    if (idx >= 0) {
      active.group.commands.splice(idx, 1)
    }
  }

  // ── Internal ─────────────────────────────────────────────

  private startGroup(group: PollGroup): void {
    const active: ActiveGroup = {
      group: { ...group, commands: [...group.commands] },
      timerId: null,
    }

    active.timerId = setInterval(() => this.pollGroup(active.group), group.intervalMs)
    this.activeGroups.set(group.name, active)
  }

  private pollGroup(group: PollGroup): void {
    // Adaptive backoff: skip this tick if queue is saturated
    if (this.queue.pending > MAX_PENDING_BEFORE_SKIP) return

    for (const command of group.commands) {
      this.queue.send(command).then(
        (frame) => {
          if (frame.direction === 'response') {
            this.onData(command, frame.payload)
          }
        },
        () => {
          // Timeout or disconnect. Silently ignore.
          // The queue handles retries internally.
        },
      )
    }
  }
}
