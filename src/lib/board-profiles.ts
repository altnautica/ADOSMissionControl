/**
 * Board profiles with timer group definitions for output protocol conflict detection.
 *
 * On STM32-based flight controllers, PWM/DShot outputs are driven by hardware timers.
 * All outputs sharing a timer group MUST use the same protocol (all PWM or all DShot).
 * Mixing protocols within a group causes ArduPilot to disable the minority outputs,
 * triggering "SERVOx_FUNCTION on disabled channel" PreArm failures.
 *
 * Board data lives in src/lib/boards/ardupilot-boards.ts.
 *
 * @license GPL-3.0-only
 */

import { ARDUPILOT_BOARDS, findArduPilotBoard } from './boards/ardupilot-boards'
import type { ArduPilotBoardEntry } from './boards/ardupilot-boards'
import type { SelectOptionGroup } from '@/components/ui/select-types'

// ── Types ────────────────────────────────────────────────────

export interface BoardProfile {
  name: string
  vendor: string
  /** AP_FW_BOARD_ID values from AUTOPILOT_VERSION.board_version */
  boardIds: number[]
  outputCount: number
  /** Timer groups — each sub-array lists output numbers (1-based) sharing a timer */
  timerGroups: number[][]
  /** Notes for specific outputs (e.g. solder pads, LED pads) */
  outputNotes: Record<number, string>
  /** Per-group protocol support */
  protocols: ('PWM' | 'DShot' | 'Both')[]
  /** Whether this board has verified timer group data */
  hasTimerData: boolean
}

// ── Motor function IDs (from servo-functions.ts) ─────────────

/** Motor function IDs: Motor1-Motor8 (33-40), Motor9-Motor12 (82-85) */
export const MOTOR_FUNCTION_IDS = new Set([33, 34, 35, 36, 37, 38, 39, 40, 82, 83, 84, 85])

/** MOT_PWM_TYPE values — 0 = Normal PWM, 4+ = DShot variants */
export const MOT_PWM_TYPE = {
  NORMAL: 0,
  ONESHOT: 1,
  ONESHOT125: 2,
  BRUSHED: 3,
  DSHOT150: 4,
  DSHOT300: 5,
  DSHOT600: 6,
  DSHOT1200: 7,
} as const

/** Returns true if the MOT_PWM_TYPE value indicates DShot protocol */
export function isDShotType(motPwmType: number): boolean {
  return motPwmType >= MOT_PWM_TYPE.DSHOT150
}

// ── Convert registry entries to board profiles ──────────────

function entryToProfile(entry: ArduPilotBoardEntry): BoardProfile {
  const hasTimer = !!entry.timerGroups && entry.timerGroups.length > 0
  return {
    name: entry.displayName,
    vendor: entry.vendor,
    boardIds: entry.boardIds,
    outputCount: entry.outputCount ?? 0,
    timerGroups: entry.timerGroups ?? [],
    outputNotes: entry.outputNotes ?? {},
    protocols: entry.protocols ?? [],
    hasTimerData: hasTimer,
  }
}

/** All board profiles built from the local board registry. */
export const BOARD_PROFILES: BoardProfile[] = ARDUPILOT_BOARDS.map(entryToProfile)

/** Fallback profile when no board is detected */
export const UNKNOWN_BOARD: BoardProfile = {
  name: 'Unknown Board',
  vendor: 'Unknown',
  boardIds: [],
  outputCount: 16,
  timerGroups: [],
  outputNotes: {},
  protocols: [],
  hasTimerData: false,
}

// ── Detection & Lookup ───────────────────────────────────────

/**
 * Find a board profile by AP_FW_BOARD_ID (decoded from AUTOPILOT_VERSION
 * board_version). Returns UNKNOWN_BOARD if no match found.
 */
export function detectBoardProfile(boardId: number): BoardProfile {
  const entry = findArduPilotBoard(boardId)
  if (entry) return entryToProfile(entry)
  return UNKNOWN_BOARD
}

/**
 * Get the board profile list for manual selection UI, grouped by vendor.
 */
export function getBoardProfileListGrouped(): SelectOptionGroup[] {
  const grouped = new Map<string, BoardProfile[]>()

  for (const profile of BOARD_PROFILES) {
    // Only show boards with timer data in the timer group selector
    if (!profile.hasTimerData) continue
    const list = grouped.get(profile.vendor) ?? []
    list.push(profile)
    grouped.set(profile.vendor, list)
  }

  const groups: SelectOptionGroup[] = []
  const sortedVendors = Array.from(grouped.keys()).sort()

  for (const vendor of sortedVendors) {
    const boards = grouped.get(vendor) ?? []
    groups.push({
      label: vendor,
      options: boards.map((b) => ({
        value: b.name,
        label: b.name,
        description: b.hasTimerData
          ? `${b.outputCount} outputs, ${b.timerGroups.length} timer groups`
          : 'No timer data',
      })),
    })
  }

  return groups
}

/**
 * Find a board profile by name (for manual selection).
 */
export function getBoardProfileByName(name: string): BoardProfile {
  return BOARD_PROFILES.find((b) => b.name === name) ?? UNKNOWN_BOARD
}

// ── Conflict Detection ───────────────────────────────────────

export interface TimerGroupConflict {
  /** Timer group index (0-based) */
  groupIndex: number
  /** Output numbers in this group (1-based) */
  outputs: number[]
  /** Outputs running DShot (motor functions with MOT_PWM_TYPE >= 4) */
  dshotOutputs: number[]
  /** Outputs running PWM (non-motor, non-disabled, non-GPIO functions) */
  pwmOutputs: number[]
  /** Outputs that are disabled due to the conflict */
  disabledOutputs: number[]
}

/**
 * Detect timer group protocol conflicts.
 *
 * A conflict exists when a timer group contains both DShot motor outputs
 * and PWM servo outputs. ArduPilot disables the minority protocol outputs.
 *
 * @param board - Board profile with timer group layout
 * @param functions - Map of output number (1-based) to SERVOx_FUNCTION value
 * @param motPwmType - Value of MOT_PWM_TYPE parameter (0=PWM, 4+=DShot)
 */
export function detectTimerGroupConflicts(
  board: BoardProfile,
  functions: Map<number, number>,
  motPwmType: number,
): TimerGroupConflict[] {
  if (board.timerGroups.length === 0) return []

  const useDShot = isDShotType(motPwmType)
  const conflicts: TimerGroupConflict[] = []

  for (let gi = 0; gi < board.timerGroups.length; gi++) {
    const group = board.timerGroups[gi]
    const dshotOutputs: number[] = []
    const pwmOutputs: number[] = []

    for (const output of group) {
      const fn = functions.get(output) ?? 0
      if (fn === 0 || fn === -1) continue // Disabled or GPIO — no conflict contribution

      if (MOTOR_FUNCTION_IDS.has(fn) && useDShot) {
        dshotOutputs.push(output)
      } else if (fn > 0) {
        pwmOutputs.push(output)
      }
    }

    // Conflict: group has BOTH DShot and PWM outputs
    if (dshotOutputs.length > 0 && pwmOutputs.length > 0) {
      // ArduPilot disables the PWM outputs when DShot is the dominant protocol
      conflicts.push({
        groupIndex: gi,
        outputs: group,
        dshotOutputs,
        pwmOutputs,
        disabledOutputs: pwmOutputs, // PWM outputs get disabled in a DShot group
      })
    }
  }

  return conflicts
}

/**
 * Get the protocol type for a specific output.
 */
export function getOutputProtocol(
  fn: number,
  motPwmType: number,
): 'DShot' | 'PWM' | 'Disabled' | 'GPIO' {
  if (fn === -1) return 'GPIO'
  if (fn === 0) return 'Disabled'
  if (MOTOR_FUNCTION_IDS.has(fn) && isDShotType(motPwmType)) return 'DShot'
  return 'PWM'
}

/**
 * Find which timer group an output belongs to.
 * Returns -1 if output is not in any group.
 */
export function getTimerGroupForOutput(board: BoardProfile, output: number): number {
  return board.timerGroups.findIndex((group) => group.includes(output))
}
