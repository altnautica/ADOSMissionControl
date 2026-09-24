/**
 * Protocol detector for Altnautica Command GCS.
 *
 * Probes a transport to detect the protocol (MAVLink or MSP) and firmware
 * type by sending probe messages and analyzing responses. Probe bytes go
 * through the same streaming parsers the adapters use, so a reply split
 * across reads, or several replies in one read, are all seen, and only
 * checksum-valid frames count.
 *
 * @module protocol/detector
 */

import type { FirmwareType } from './types'
import { MAVLinkParser } from './mavlink-parser'
import { MspParser } from './msp/msp-parser'
import { encodeMsp } from './msp/msp-codec'
import { MSP } from './msp/msp-constants'
import { encodeHeartbeat } from './mavlink-encoder'
import { decodeHeartbeat } from './mavlink-messages'
import { createFirmwareHandler } from './firmware/ardupilot'

/** HEARTBEAT message ID. */
const MSG_HEARTBEAT = 0

/** How long each probe listens before giving up. */
const MAVLINK_PROBE_MS = 3000
const MSP_PROBE_MS = 2000

// ---------------------------------------------------------------------------
// Detection result
// ---------------------------------------------------------------------------

export interface DetectionResult {
  protocol: 'mavlink' | 'msp' | 'unknown'
  firmwareType: FirmwareType
  systemId?: number
  componentId?: number
  mavType?: number
}

type SendFn = (data: Uint8Array) => void
type OnDataFn = (handler: (data: Uint8Array) => void) => () => void

/**
 * Classify an MSP `FC_VARIANT` identifier into a firmware family.
 *
 * Returns `null` for an EMPTY identifier: an `API_VERSION` reply confirms the
 * transport speaks MSP but names no variant, so the caller must keep waiting
 * for the real `FC_VARIANT` reply rather than defaulting — this is what stops
 * an iNav board whose `API_VERSION` arrives first from being mislabeled
 * Betaflight. A recognized identifier maps to its family; any other non-empty
 * identifier is a confirmed-but-unmodeled MSP FC (`'unknown'`), driven over MSP
 * without a false family claim.
 */
export function classifyMspVariant(variant: string): FirmwareType | null {
  const v = variant.trim().toUpperCase()
  if (v === 'INAV') return 'inav'
  if (v === 'BTFL') return 'betaflight'
  if (v.length > 0) return 'unknown'
  return null
}

/**
 * Listen for a CRC-valid HEARTBEAT after sending one of ours. Any heartbeat
 * proves the link speaks MAVLink; the firmware comes from its autopilot and
 * vehicle type, classified exactly as the adapter classifies them.
 */
function probeMavlink(sendFn: SendFn, onData: OnDataFn): Promise<DetectionResult | null> {
  const { promise, resolve } = Promise.withResolvers<DetectionResult | null>()
  const parser = new MAVLinkParser()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let unsubData: (() => void) | undefined
  const finish = (result: DetectionResult | null) => {
    clearTimeout(timeout)
    unsubFrame()
    unsubData?.()
    resolve(result)
  }
  const unsubFrame = parser.onFrame((frame) => {
    if (frame.msgId !== MSG_HEARTBEAT) return
    const hb = decodeHeartbeat(frame.payload)
    finish({
      protocol: 'mavlink',
      firmwareType: createFirmwareHandler(hb.autopilot, hb.type).firmwareType,
      systemId: frame.systemId,
      componentId: frame.componentId,
      mavType: hb.type,
    })
  })
  unsubData = onData((data) => parser.feed(data))
  timeout = setTimeout(() => finish(null), MAVLINK_PROBE_MS)
  sendFn(encodeHeartbeat())
  return promise
}

/**
 * Ask for API_VERSION and FC_VARIANT. The firmware family is committed only on
 * a positive FC_VARIANT identifier; an MSP reply without one still proves the
 * link speaks MSP, which the timeout reports as an unmodeled MSP board.
 */
function probeMsp(sendFn: SendFn, onData: OnDataFn): Promise<DetectionResult | null> {
  const { promise, resolve } = Promise.withResolvers<DetectionResult | null>()
  const parser = new MspParser()
  let mspConfirmed = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let unsubData: (() => void) | undefined
  const finish = (result: DetectionResult | null) => {
    clearTimeout(timeout)
    unsubFrame()
    unsubData?.()
    resolve(result)
  }
  const unsubFrame = parser.onFrame((frame) => {
    // Any MSP frame, an error reply included, confirms the protocol.
    mspConfirmed = true
    if (frame.direction !== 'response' || frame.command !== MSP.MSP_FC_VARIANT) return
    const firmwareType = classifyMspVariant(String.fromCharCode(...frame.payload.subarray(0, 4)))
    if (firmwareType !== null) finish({ protocol: 'msp', firmwareType })
  })
  unsubData = onData((data) => parser.feed(data))
  timeout = setTimeout(
    () => finish(mspConfirmed ? { protocol: 'msp', firmwareType: 'unknown' } : null),
    MSP_PROBE_MS,
  )
  sendFn(encodeMsp(MSP.MSP_API_VERSION))
  sendFn(encodeMsp(MSP.MSP_FC_VARIANT))
  return promise
}

/**
 * Probe a transport to detect the protocol and firmware.
 *
 * Sends a MAVLink HEARTBEAT first (3 s window). If no heartbeat arrives,
 * asks for MSP API_VERSION + FC_VARIANT (2 s window).
 *
 * @param sendFn   Send raw bytes to the transport
 * @param onData   Subscribe to incoming data; returns an unsubscribe fn
 */
export async function detectProtocol(sendFn: SendFn, onData: OnDataFn): Promise<DetectionResult> {
  const mavResult = await probeMavlink(sendFn, onData)
  if (mavResult) return mavResult
  const mspResult = await probeMsp(sendFn, onData)
  if (mspResult) return mspResult
  return { protocol: 'unknown', firmwareType: 'unknown' }
}
