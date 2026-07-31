/**
 * RC channel state for an MSP link.
 *
 * `MSP_SET_RAW_RC` is not a message, it is a picture of every RC channel at
 * once. A sender that builds a fresh frame of literals for each command has no
 * idea what it is writing into the channels it did not mean to touch, and the
 * flight controller obeys all of them equally: the AUX channels carry the arm
 * switch and every mode switch. This model owns that picture — current value
 * per channel, how many channels the frame carries, and which PWM values on
 * which AUX channel activate a configured mode — so no caller has to guess.
 *
 * Two invariants the model exists to hold:
 *
 * 1. Throttle idles at {@link RC_MIN}. Center is half throttle on an MSP
 *    flight controller, so a frame that has not been given a live stick value
 *    must never carry 1500 in the throttle slot.
 * 2. An AUX channel the caller did not write carries a value proven to be
 *    outside every mode range configured on it. A resting value that happens
 *    to fall inside the arm range arms the aircraft.
 *
 * @module protocol/msp/msp-rc-channels
 */

import type { ModeRange } from './msp-mode-map'

/** Low rail. Throttle idle and the conventional "switch off" AUX value. */
export const RC_MIN = 1000
/** Stick center for roll, pitch, and yaw. */
export const RC_MID = 1500
/** High rail. */
export const RC_MAX = 2000
/** Lowest PWM a mode range can be configured against. */
export const RC_FLOOR = 900
/** Highest PWM a mode range can be configured against. */
export const RC_CEIL = 2100
/**
 * Throttle value for a motor cut. Below `rx_min_usec` on both Betaflight and
 * iNav, so it reads as an out-of-range channel rather than a low stick.
 */
export const RC_THROTTLE_CUT = 885

export const CH_ROLL = 0
export const CH_PITCH = 1
export const CH_THROTTLE = 2
export const CH_YAW = 3
/** RC channel index of AUX1. The first four channels are the sticks. */
export const FIRST_AUX_CHANNEL = 4
/** Both Betaflight and iNav reject an `MSP_SET_RAW_RC` frame wider than this. */
export const MAX_RC_CHANNELS = 18
/** Narrowest frame we emit, so a stock four-AUX setup is always covered. */
export const MIN_RC_CHANNELS = 8

/** An AUX channel whose resting value cannot be placed outside its mode ranges. */
export interface UnsafeAuxChannel {
  auxIndex: number
  channel: number
  reason: string
}

/** Outcome of a write the model may refuse. */
export type RcWriteResult = { ok: true } | { ok: false; reason: string }

/** Betaflight and iNav both test a mode range as `[start, end)` against raw PWM. */
function rangeContains(range: ModeRange, pwm: number): boolean {
  return pwm >= range.rangeStart && pwm < range.rangeEnd
}

function clampPwm(pwm: number): number {
  return Math.max(RC_FLOOR, Math.min(RC_CEIL, Math.round(pwm)))
}

/** Map a -1..1 stick axis onto the 1000..2000 PWM band, center at 1500. */
export function bipolarToPwm(value: number): number {
  const v = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
  return Math.round(RC_MID + v * (RC_MAX - RC_MID))
}

/** Map a 0..1 throttle axis onto the 1000..2000 PWM band, idle at 1000. */
export function throttleToPwm(value: number): number {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return Math.round(RC_MIN + v * (RC_MAX - RC_MIN))
}

export class MspRcChannels {
  private readonly ranges: readonly ModeRange[]
  private readonly count: number
  private readonly values: number[]
  /** Resting value per AUX index, proven outside every range on that channel. */
  private readonly auxIdle: Array<number | null> = []
  private cut = false

  constructor(modeRanges: readonly ModeRange[]) {
    this.ranges = modeRanges.slice()

    // Size the frame once, at construction, to cover every configured mode
    // range. The width can never change afterwards: a flight controller keeps
    // the last value it saw for any channel beyond the current frame width, so
    // a frame that narrows would freeze the AUX channels it dropped at
    // whatever they held.
    let widest = MIN_RC_CHANNELS
    for (const r of this.ranges) {
      widest = Math.max(widest, FIRST_AUX_CHANNEL + r.auxChannel + 1)
    }
    this.count = Math.min(widest, MAX_RC_CHANNELS)

    for (let aux = 0; aux + FIRST_AUX_CHANNEL < this.count; aux++) {
      this.auxIdle.push(this.computeAuxIdle(aux))
    }

    this.values = new Array<number>(this.count)
    this.reset()
  }

  get channelCount(): number { return this.count }
  get isCut(): boolean { return this.cut }

  /** The current PWM on an RC channel index, or undefined past the frame width. */
  channelValue(channel: number): number | undefined {
    return this.values[channel]
  }

  /**
   * AUX channels the model cannot rest safely, because their configured mode
   * ranges leave no PWM value that activates nothing. A caller that finds this
   * non-empty must not transmit: every frame it sends would hold a mode on.
   */
  unsafeAux(): UnsafeAuxChannel[] {
    const out: UnsafeAuxChannel[] = []
    for (let aux = 0; aux < this.auxIdle.length; aux++) {
      if (this.auxIdle[aux] !== null) continue
      out.push({
        auxIndex: aux,
        channel: FIRST_AUX_CHANNEL + aux,
        reason: `AUX${aux + 1} mode ranges cover the whole ${RC_FLOOR}-${RC_CEIL} band, so no resting value leaves every mode off`,
      })
    }
    return out
  }

  /** Sticks to their rest position and every AUX to its proven-idle value. */
  reset(): void {
    this.values[CH_ROLL] = RC_MID
    this.values[CH_PITCH] = RC_MID
    this.values[CH_YAW] = RC_MID
    this.values[CH_THROTTLE] = RC_MIN
    for (let aux = 0; aux < this.auxIdle.length; aux++) {
      this.values[FIRST_AUX_CHANNEL + aux] = this.auxIdle[aux] ?? RC_MIN
    }
  }

  /**
   * Write a live stick frame. Roll, pitch, and yaw are -1..1; throttle is
   * 0..1 with 0 as idle. Refused while the cut is latched — a latched cut owns
   * the throttle until it is released.
   */
  setSticks(roll: number, pitch: number, throttle: number, yaw: number): RcWriteResult {
    if (this.cut) return { ok: false, reason: 'motor cut is latched' }
    this.values[CH_ROLL] = bipolarToPwm(roll)
    this.values[CH_PITCH] = bipolarToPwm(pitch)
    this.values[CH_YAW] = bipolarToPwm(yaw)
    this.values[CH_THROTTLE] = throttleToPwm(throttle)
    return { ok: true }
  }

  /**
   * Write one AUX channel. `auxIndex` is 0-based (0 is AUX1), matching the
   * `auxChannel` field of a mode range. Refused rather than silently dropped
   * when the channel is outside the frame, and refused while the cut is
   * latched for any value that would turn a mode on.
   */
  setAux(auxIndex: number, pwm: number): RcWriteResult {
    const channel = FIRST_AUX_CHANNEL + auxIndex
    if (!Number.isInteger(auxIndex) || auxIndex < 0) {
      return { ok: false, reason: `AUX index ${auxIndex} is not a channel` }
    }
    if (channel >= this.count) {
      return {
        ok: false,
        reason: `AUX${auxIndex + 1} is channel ${channel + 1}, past the ${this.count}-channel frame this link carries`,
      }
    }
    const value = clampPwm(pwm)
    if (this.cut && this.activatesMode(auxIndex, value)) {
      return { ok: false, reason: 'motor cut is latched' }
    }
    this.values[channel] = value
    return { ok: true }
  }

  /**
   * The value this AUX channel rests at: the lowest PWM that activates no
   * configured mode. Null when no such value exists, undefined past the frame
   * width.
   */
  idleValueFor(auxIndex: number): number | null | undefined {
    if (auxIndex < 0 || auxIndex >= this.auxIdle.length) return undefined
    return this.auxIdle[auxIndex]
  }

  /** True when `pwm` on this AUX channel turns some configured mode on. */
  activatesMode(auxIndex: number, pwm: number): boolean {
    return this.ranges.some(r => r.auxChannel === auxIndex && rangeContains(r, pwm))
  }

  /**
   * Latch a motor cut. Until it is released every emitted frame carries the
   * cut throttle, centered sticks, and every AUX at its idle value, so the
   * arm switch goes low with it.
   */
  engageCut(): void {
    this.cut = true
    this.reset()
    this.values[CH_THROTTLE] = RC_THROTTLE_CUT
  }

  /** Release the latch and return the frame to its rest position. */
  releaseCut(): void {
    this.cut = false
    this.reset()
  }

  /** Serialize the current picture as an `MSP_SET_RAW_RC` payload. */
  toPayload(): Uint8Array {
    const payload = new Uint8Array(this.count * 2)
    for (let i = 0; i < this.count; i++) {
      const v = this.values[i]
      payload[i * 2] = v & 0xff
      payload[i * 2 + 1] = (v >> 8) & 0xff
    }
    return payload
  }

  /**
   * Lowest PWM on this AUX channel that activates no configured mode, or null
   * when the ranges leave no such value.
   */
  private computeAuxIdle(auxIndex: number): number | null {
    const onThisChannel = this.ranges.filter(r => r.auxChannel === auxIndex)
    if (onThisChannel.length === 0) return RC_MIN

    const candidates = [RC_MIN, RC_FLOOR, RC_CEIL, RC_MAX]
    for (const r of onThisChannel) candidates.push(r.rangeEnd)
    for (const candidate of candidates) {
      if (candidate < RC_FLOOR || candidate > RC_CEIL) continue
      if (!onThisChannel.some(r => rangeContains(r, candidate))) return candidate
    }
    return null
  }
}
