/**
 * Shared helpers for the iNav MSP adapter section modules: error constants
 * and small payload decoders used by more than one file.
 *
 * @module protocol/msp-adapter/inav/helpers
 */

import type { CommandResult } from '../../types'

export const NOT_CONNECTED: CommandResult = { success: false, resultCode: -1, message: 'Not connected' }

/**
 * Decode MSP_WP_GETINFO response.
 * Payload: U8 confirmationResult, U8 waypointCount, U8 validMissionCountByte, U8 currentMissionIndex
 */
export function decodeWpGetInfo(payload: Uint8Array): { waypointCount: number; missionIndex: number } {
  if (payload.length < 4) return { waypointCount: 0, missionIndex: 0 }
  return {
    waypointCount: payload[1],
    missionIndex: payload[3],
  }
}

/** Build a DataView over an MSP payload without an intermediate copy. */
export function dv(payload: Uint8Array): DataView {
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
}
