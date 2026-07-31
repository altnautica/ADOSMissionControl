/**
 * The single owner of RC-override traffic on an MSP link.
 *
 * Wraps {@link MspRcChannels} with the two things a channel picture cannot do
 * by itself: decide whether the frame is worth putting on the wire at all, and
 * keep a motor cut there once it has been commanded.
 *
 * Whether the frame is worth sending is not a detail. `MSP_SET_RAW_RC` only
 * reaches `rcData[]` when the flight controller's receiver provider is MSP;
 * with any other receiver the flight controller parses the frame and throws it
 * away. A sender that reports success in that case is describing something
 * that did not happen, and arming through it fails silently.
 *
 * Keeping the cut there is the other half. One frame of low throttle is
 * overwritten by the next frame from the real receiver, so a cut that is sent
 * once is a cut that lasts one frame. The latch holds the cut picture and
 * re-emits it until it is explicitly released.
 *
 * @module protocol/msp/msp-rc-override
 */

import type { ModeRange } from './msp-mode-map'
import { MspRcChannels, type RcWriteResult } from './msp-rc-channels'

/** Cadence of the latched-cut repeat, in milliseconds. */
const CUT_REPEAT_MS = 50

export interface MspRcOverrideOptions {
  /** Fire-and-forget transmit of one `MSP_SET_RAW_RC` payload. */
  send: (payload: Uint8Array) => void
  modeRanges: readonly ModeRange[]
  /**
   * True only when the flight controller's receiver provider is MSP. Read from
   * the feature bitmask at connect; false when it could not be read, because
   * an unread feature word is not evidence that the override works.
   */
  rxMspEnabled: boolean
}

export class MspRcOverride {
  private readonly channels: MspRcChannels
  private readonly send: (payload: Uint8Array) => void
  private readonly blocked: string | null
  private repeat: ReturnType<typeof setInterval> | null = null
  private destroyed = false

  constructor(opts: MspRcOverrideOptions) {
    this.channels = new MspRcChannels(opts.modeRanges)
    this.send = opts.send
    this.blocked = this.computeBlock(opts.rxMspEnabled)
  }

  /** Why this link cannot carry an RC override, or null when it can. */
  get blockedReason(): string | null { return this.blocked }
  get isCut(): boolean { return this.channels.isCut }
  get channelCount(): number { return this.channels.channelCount }

  /** The current PWM on an RC channel index, or undefined past the frame width. */
  channelValue(channel: number): number | undefined {
    return this.channels.channelValue(channel)
  }

  /**
   * The value an AUX channel rests at with every mode on it off. Null when the
   * configured ranges leave no such value, undefined past the frame width.
   */
  idleValueFor(auxIndex: number): number | null | undefined {
    return this.channels.idleValueFor(auxIndex)
  }

  /**
   * Emit a live stick frame. Roll, pitch, and yaw are -1..1; throttle is 0..1
   * with 0 as idle. Nothing is transmitted when the write is refused.
   */
  sendSticks(roll: number, pitch: number, throttle: number, yaw: number): RcWriteResult {
    const gate = this.gate()
    if (!gate.ok) return gate
    const write = this.channels.setSticks(roll, pitch, throttle, yaw)
    if (!write.ok) return write
    this.transmit()
    return { ok: true }
  }

  /**
   * Drive one AUX channel to a PWM value and emit the frame. `auxIndex` is
   * 0-based, matching the `auxChannel` field of a mode range.
   */
  setAux(auxIndex: number, pwm: number): RcWriteResult {
    const gate = this.gate()
    if (!gate.ok) return gate
    const write = this.channels.setAux(auxIndex, pwm)
    if (!write.ok) return write
    this.transmit()
    return { ok: true }
  }

  /**
   * Latch a motor cut and hold it on the wire. Idempotent: re-engaging an
   * already-latched cut restarts nothing and stays latched.
   */
  engageCut(): RcWriteResult {
    const gate = this.gate()
    if (!gate.ok) return gate
    this.channels.engageCut()
    this.transmit()
    if (!this.repeat) {
      this.repeat = setInterval(() => this.transmit(), CUT_REPEAT_MS)
    }
    return { ok: true }
  }

  /** Release the latch. The frame returns to idle throttle and every mode off. */
  releaseCut(): void {
    this.stopRepeat()
    if (!this.channels.isCut) return
    this.channels.releaseCut()
    if (!this.blocked && !this.destroyed) this.transmit()
  }

  /** Stop the latch repeat. Called when the link goes away. */
  destroy(): void {
    this.destroyed = true
    this.stopRepeat()
  }

  private gate(): RcWriteResult {
    if (this.destroyed) return { ok: false, reason: 'link closed' }
    if (this.blocked) return { ok: false, reason: this.blocked }
    return { ok: true }
  }

  private transmit(): void {
    if (this.destroyed) return
    this.send(this.channels.toPayload())
  }

  private stopRepeat(): void {
    if (!this.repeat) return
    clearInterval(this.repeat)
    this.repeat = null
  }

  private computeBlock(rxMspEnabled: boolean): string | null {
    if (!rxMspEnabled) {
      return 'the flight controller is not configured for an MSP receiver, so it discards RC override frames'
    }
    const unsafe = this.channels.unsafeAux()
    if (unsafe.length > 0) return unsafe.map(u => u.reason).join('; ')
    return null
  }
}
