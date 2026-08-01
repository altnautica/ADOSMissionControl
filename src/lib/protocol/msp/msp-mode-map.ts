/**
 * Betaflight box-based mode mapping to unified flight modes.
 *
 * Betaflight uses dynamic "box" modes queried at connect time via
 * MSP_BOXNAMES + MSP_BOXIDS. Each box has a permanent ID (from firmware
 * source `box.c`) and is activated by AUX channel ranges.
 *
 * Reference: betaflight/src/main/fc/rc_modes.h, box.c
 *
 * @module protocol/msp/msp-mode-map
 */

import type { FirmwareType, UnifiedFlightMode } from '../types'
import { INAV_BOX_TO_MODE } from '../firmware/inav'

// ── Permanent Box ID to Unified Mode ────────────────────────

/**
 * Maps Betaflight permanent box IDs to unified flight modes.
 * Only flight-mode boxes are included; feature toggles (AIRMODE,
 * ANTI_GRAVITY, BEEPER, etc.) are omitted.
 */
export const BOX_ID_TO_MODE: ReadonlyMap<number, UnifiedFlightMode> = new Map<number, UnifiedFlightMode>([
  // 0 = ARM (handled separately, not a flight mode)
  [1, 'STABILIZE'],     // ANGLE
  [2, 'ALT_HOLD'],      // HORIZON
  [5, 'MANUAL'],         // HEADFREE
  [19, 'ACRO'],          // ACRO_TRAINER
  [35, 'UNKNOWN'],       // TURTLE (flip-over-after-crash recovery)
  [36, 'RTL'],           // GPS_RESCUE
  [49, 'UNKNOWN'],       // LAUNCH_CONTROL
])

/** Box IDs that are features, not flight modes. Listed for reference. */
export const FEATURE_BOX_IDS = new Set<number>([
  0,   // ARM (special, not a flight mode)
  3,   // ANTI_GRAVITY
  6,   // HEADADJ
  26,  // BEEPER
  27,  // AIRMODE
  28,  // 3D
  33,  // FAILSAFE
])

// ── Mode priority (higher index = higher priority) ──────────

const MODE_PRIORITY: UnifiedFlightMode[] = [
  'ACRO',       // lowest (default)
  'MANUAL',
  'UNKNOWN',
  'ALT_HOLD',
  'STABILIZE',
  // Navigation modes outrank the stabilizing ones: when a nav box and an
  // attitude box are active together the autopilot is flying, and that is the
  // state every consumer needs to see.
  'POSHOLD',
  'LOITER',
  'CRUISE',
  'TAKEOFF',
  'MISSION',
  'RTL',        // highest
]

function modePriority(mode: UnifiedFlightMode): number {
  const idx = MODE_PRIORITY.indexOf(mode)
  return idx >= 0 ? idx : -1
}

// ── Resolve Active Mode ─────────────────────────────────────

/**
 * Resolve the current active flight mode from status flags and box ID list.
 *
 * Logic:
 * 1. Iterate through boxIds array (from MSP_BOXIDS response)
 * 2. For each index, check if that bit is set in modeFlags (from MSP_STATUS_EX)
 * 3. Map active box IDs to UnifiedFlightMode using the firmware's box table
 * 4. Return the highest-priority active mode + armed state
 * 5. Fall back per firmware, see below
 *
 * Betaflight and iNav both activate boxes through AUX ranges, but they number
 * them differently: iNav's navigation boxes (NAV ALTHOLD, NAV POSHOLD, NAV RTH,
 * NAV WP, NAV LAUNCH) hold ids the Betaflight table either does not list or
 * lists as something else. Decoding one firmware against the other's table
 * therefore names the wrong mode, and naming an autonomous mode as a manual one
 * is the dangerous direction: the stick-authority allow list would let a
 * gamepad override transmit at an aircraft the autopilot is flying. So the
 * table is selected by firmware, and the fallback fails closed.
 *
 * The fallback is UNKNOWN for every firmware except Betaflight, where no active
 * mode box genuinely means ACRO. For iNav, an unrecognised or absent box is
 * exactly the state we cannot vouch for — including navigation boxes not in the
 * table — so it decodes to UNKNOWN and the gate holds the stream off.
 *
 * @param firmwareType - selects the box table; when absent the firmware has not
 *   been identified yet and the result falls closed to UNKNOWN.
 */
export function resolveActiveMode(
  modeFlags: number,
  boxIds: number[],
  firmwareType?: FirmwareType,
): { mode: UnifiedFlightMode; armed: boolean } {
  const table: (boxId: number) => UnifiedFlightMode | undefined =
    firmwareType === 'inav'
      ? (boxId) => INAV_BOX_TO_MODE[boxId]
      : (boxId) => BOX_ID_TO_MODE.get(boxId)

  // Betaflight reports no mode box active when the pilot is flying rate mode,
  // so ACRO is a real reading there rather than an absence of one.
  const fallback: UnifiedFlightMode =
    firmwareType === 'betaflight' ? 'ACRO' : 'UNKNOWN'

  let armed = false
  let bestMode: UnifiedFlightMode = fallback
  let bestPriority = -1

  for (let i = 0; i < boxIds.length; i++) {
    // Check if bit `i` is set in mode flags
    // modeFlags can exceed 32 bits in BF 4.x, but JS bitwise ops work on 32 bits.
    // For boxes beyond bit 31, use BigInt-style check.
    const wordIndex = Math.floor(i / 32)
    const bitIndex = i % 32
    // modeFlags is typically passed as a single number for first 32 bits.
    // For extended flags (BF 4.3+), caller should combine flag words.
    // We handle the simple case here (first 32 boxes).
    if (wordIndex > 0) continue // Skip boxes beyond bit 31 for now

    const isActive = (modeFlags & (1 << bitIndex)) !== 0
    if (!isActive) continue

    const boxId = boxIds[i]

    // ARM is special
    if (boxId === 0) {
      armed = true
      continue
    }

    const mode = table(boxId)
    if (mode) {
      const priority = modePriority(mode)
      if (priority > bestPriority) {
        bestPriority = priority
        bestMode = mode
      }
    }
  }

  return { mode: bestMode, armed }
}

// ── Box Map Builder ─────────────────────────────────────────

/**
 * Build a box name to box ID lookup from BOXNAMES + BOXIDS responses.
 *
 * MSP_BOXNAMES returns semicolon-separated names: "ARM;ANGLE;HORIZON;..."
 * MSP_BOXIDS returns an array of permanent box IDs (one per name, same order).
 */
export function buildBoxMap(
  boxNames: string[],
  boxIds: number[],
): Map<string, number> {
  const map = new Map<string, number>()
  const len = Math.min(boxNames.length, boxIds.length)
  for (let i = 0; i < len; i++) {
    map.set(boxNames[i], boxIds[i])
  }
  return map
}

// ── Mode Range Types ────────────────────────────────────────

/** AUX channel range that activates a specific box mode. */
export interface ModeRange {
  boxId: number
  auxChannel: number
  rangeStart: number  // PWM value (900-2100)
  rangeEnd: number    // PWM value (900-2100)
}

/**
 * Parse MSP_MODE_RANGES response into structured mode ranges.
 *
 * Each range is 4 bytes:
 *   - byte 0: permanent box ID
 *   - byte 1: AUX channel index (0 = AUX1, 1 = AUX2, ...)
 *   - byte 2: range start step (value = step * 25 + 900)
 *   - byte 3: range end step (value = step * 25 + 900)
 */
export function parseModeRanges(payload: Uint8Array): ModeRange[] {
  const ranges: ModeRange[] = []
  for (let i = 0; i + 3 < payload.length; i += 4) {
    const boxId = payload[i]
    const auxChannel = payload[i + 1]
    const rangeStart = payload[i + 2] * 25 + 900
    const rangeEnd = payload[i + 3] * 25 + 900

    // Skip empty/invalid ranges
    if (rangeStart >= rangeEnd) continue

    ranges.push({ boxId, auxChannel, rangeStart, rangeEnd })
  }
  return ranges
}

/**
 * Find the AUX channel and range that activates a specific box.
 * Returns undefined if no range is configured for this box ID.
 */
export function findModeRange(ranges: ModeRange[], boxId: number): ModeRange | undefined {
  return ranges.find(r => r.boxId === boxId)
}

/**
 * Get the box name for a unified flight mode (reverse lookup).
 * Used for UI display.
 */
export function getBoxNameForMode(mode: UnifiedFlightMode): string | undefined {
  switch (mode) {
    case 'STABILIZE': return 'ANGLE'
    case 'ALT_HOLD': return 'HORIZON'
    case 'MANUAL': return 'HEADFREE'
    case 'ACRO': return 'ACRO_TRAINER'
    case 'RTL': return 'GPS_RESCUE'
    default: return undefined
  }
}
