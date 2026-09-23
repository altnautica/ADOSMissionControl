// Exempt from 300 LOC soft rule: pure board registry data table
/**
 * ArduPilot board registry with vendor/MCU metadata and optional timer group data.
 *
 * Timer group data is only included for verified boards.
 *
 * @license GPL-3.0-only
 */

// ── Types ────────────────────────────────────────────────────

export type ArduPilotBoardCategory = 'pixhawk' | 'mini-fc' | 'wing-fc' | 'carrier' | 'linux' | 'other'

export interface ArduPilotBoardEntry {
  name: string
  displayName: string
  vendor: string
  mcu: string
  category: ArduPilotBoardCategory
  /**
   * AP_FW_BOARD_ID values (the board's APJ_BOARD_ID) this entry is detected by.
   * Each id belongs to at most one entry. Empty when the firmware build reports
   * an id shared with another entry, or no id at all.
   */
  boardIds: number[]
  outputCount?: number
  timerGroups?: number[][]
  protocols?: ('PWM' | 'DShot' | 'Both')[]
  outputNotes?: Record<number, string>
}

// ── Board Registry ──────────────────────────────────────────

export const ARDUPILOT_BOARDS: ArduPilotBoardEntry[] = [
  // ── SpeedyBee ─────────────────────────────────────────────
  {
    name: 'SpeedyBeef405Wing',
    displayName: 'SpeedyBee F405 Wing',
    vendor: 'SpeedyBee',
    mcu: 'STM32F405',
    category: 'wing-fc',
    boardIds: [1106],
    outputCount: 12,
    timerGroups: [[1, 2], [3, 4], [5, 6, 7], [8, 9, 10], [11, 12]],
    outputNotes: {
      9: 'Solder pad (S9)',
      10: 'Solder pad (S10)',
      11: 'Solder pad (S11)',
      12: 'Solder pad (S12) — default serial LED',
    },
    protocols: ['Both', 'Both', 'Both', 'Both', 'Both'],
  },
  {
    name: 'SpeedyBeef405V3',
    displayName: 'SpeedyBee F405 V3',
    vendor: 'SpeedyBee',
    mcu: 'STM32F405',
    category: 'mini-fc',
    boardIds: [1082],
    outputCount: 9,
    timerGroups: [[1, 2], [3, 4], [5, 6], [7, 8], [9]],
    outputNotes: { 9: 'LED pad — serial LED default' },
    protocols: ['Both', 'Both', 'Both', 'Both', 'PWM'],
  },
  {
    name: 'SpeedyBeef405V4',
    displayName: 'SpeedyBee F405 V4',
    vendor: 'SpeedyBee',
    mcu: 'STM32F405',
    category: 'mini-fc',
    boardIds: [1136],
    outputCount: 10,
    timerGroups: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]],
    outputNotes: { 9: 'Solder pad', 10: 'LED pad — serial LED default' },
    protocols: ['Both', 'Both', 'Both', 'Both', 'Both'],
  },

  // ── Matek ─────────────────────────────────────────────────
  {
    name: 'MatekH743',
    displayName: 'Matek H743 Wing V2',
    vendor: 'Matek',
    mcu: 'STM32H743',
    category: 'wing-fc',
    boardIds: [1013],
    outputCount: 12,
    timerGroups: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]],
    outputNotes: { 11: 'S11 — solder pad', 12: 'S12 — LED pad' },
    protocols: ['Both', 'Both', 'Both', 'Both', 'Both', 'PWM'],
  },
  {
    name: 'MatekF405-Wing',
    displayName: 'Matek F405-Wing / F405-SE',
    vendor: 'Matek',
    mcu: 'STM32F405',
    category: 'wing-fc',
    boardIds: [127],
  },
  {
    name: 'MatekF765-Wing',
    displayName: 'Matek F765-Wing',
    vendor: 'Matek',
    mcu: 'STM32F767',
    category: 'wing-fc',
    boardIds: [143],
  },

  // ── Holybro ───────────────────────────────────────────────
  {
    name: 'Pixhawk4',
    displayName: 'Pixhawk 4',
    vendor: 'Holybro',
    mcu: 'STM32F767',
    category: 'pixhawk',
    boardIds: [50],
    outputCount: 16,
    timerGroups: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
    outputNotes: {
      9: 'AUX 1', 10: 'AUX 2', 11: 'AUX 3', 12: 'AUX 4',
      13: 'AUX 5', 14: 'AUX 6', 15: 'AUX 7', 16: 'AUX 8',
    },
    protocols: ['Both', 'Both', 'Both', 'Both'],
  },
  {
    name: 'Pixhawk6C',
    displayName: 'Pixhawk 6C',
    vendor: 'Holybro',
    mcu: 'STM32H743',
    category: 'pixhawk',
    boardIds: [56],
    outputCount: 16,
    timerGroups: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
    outputNotes: {
      9: 'AUX 1', 10: 'AUX 2', 11: 'AUX 3', 12: 'AUX 4',
      13: 'AUX 5', 14: 'AUX 6', 15: 'AUX 7', 16: 'AUX 8',
    },
    protocols: ['Both', 'Both', 'Both', 'Both'],
  },
  {
    name: 'Pixhawk6X',
    displayName: 'Pixhawk 6X',
    vendor: 'Holybro',
    mcu: 'STM32H743',
    category: 'pixhawk',
    boardIds: [53],
    outputCount: 16,
    timerGroups: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
    outputNotes: {
      9: 'AUX 1', 10: 'AUX 2', 11: 'AUX 3', 12: 'AUX 4',
      13: 'AUX 5', 14: 'AUX 6', 15: 'AUX 7', 16: 'AUX 8',
    },
    protocols: ['Both', 'Both', 'Both', 'Both'],
  },
  {
    name: 'KakuteF7',
    displayName: 'Holybro Kakute F7',
    vendor: 'Holybro',
    mcu: 'STM32F745',
    category: 'mini-fc',
    boardIds: [123],
  },
  {
    name: 'KakuteH7',
    displayName: 'Holybro Kakute H7',
    vendor: 'Holybro',
    mcu: 'STM32H743',
    category: 'mini-fc',
    boardIds: [1048],
  },
  {
    name: 'KakuteH7Mini',
    displayName: 'Holybro Kakute H7 Mini',
    vendor: 'Holybro',
    mcu: 'STM32H743',
    category: 'mini-fc',
    boardIds: [1058],
  },
  {
    name: 'Durandal',
    displayName: 'Holybro Durandal',
    vendor: 'Holybro',
    mcu: 'STM32H743',
    category: 'pixhawk',
    boardIds: [139],
  },

  // ── CubePilot ─────────────────────────────────────────────
  {
    name: 'CubeBlack',
    displayName: 'CubeBlack',
    vendor: 'CubePilot',
    mcu: 'STM32F427',
    category: 'pixhawk',
    boardIds: [9],
  },
  {
    name: 'CubeOrange',
    displayName: 'CubeOrange',
    vendor: 'CubePilot',
    mcu: 'STM32H743',
    category: 'pixhawk',
    boardIds: [140],
  },
  {
    name: 'CubeOrangePlus',
    displayName: 'CubeOrange+',
    vendor: 'CubePilot',
    mcu: 'STM32H757',
    category: 'pixhawk',
    boardIds: [1063],
  },
  {
    name: 'CubeYellow',
    displayName: 'CubeYellow',
    vendor: 'CubePilot',
    mcu: 'STM32F777',
    category: 'pixhawk',
    boardIds: [120],
  },

  // ── CUAV ──────────────────────────────────────────────────
  {
    name: 'CUAVv5plus',
    displayName: 'CUAV V5+',
    vendor: 'CUAV',
    mcu: 'STM32F767',
    category: 'pixhawk',
    // Runs the FMUv5 build and reports board id 50, the same as Pixhawk 4.
    boardIds: [],
  },
  {
    name: 'CUAVX7',
    displayName: 'CUAV X7',
    vendor: 'CUAV',
    mcu: 'STM32H743',
    category: 'pixhawk',
    boardIds: [1010],
  },
  {
    name: 'CUAVNora',
    displayName: 'CUAV Nora',
    vendor: 'CUAV',
    mcu: 'STM32H743',
    category: 'pixhawk',
    boardIds: [1009],
  },

  // ── mRo ───────────────────────────────────────────────────
  {
    name: 'mRoPixracer',
    displayName: 'mRo Pixracer',
    vendor: 'mRo',
    mcu: 'STM32F427',
    category: 'mini-fc',
    boardIds: [11],
  },
  {
    name: 'mRoControlZeroH7',
    displayName: 'mRo Control Zero H7',
    vendor: 'mRo',
    mcu: 'STM32H743',
    category: 'mini-fc',
    boardIds: [1023],
  },
  {
    name: 'mRoControlZeroOEMH7',
    displayName: 'mRo Control Zero H7 OEM',
    vendor: 'mRo',
    mcu: 'STM32H743',
    category: 'mini-fc',
    boardIds: [1024],
  },
  {
    name: 'mRoNexus',
    displayName: 'mRo Nexus',
    vendor: 'mRo',
    mcu: 'STM32H743',
    category: 'carrier',
    boardIds: [1015],
  },

  // ── Flywoo ────────────────────────────────────────────────
  {
    name: 'FlywooF405Pro',
    displayName: 'Flywoo F405 Pro',
    vendor: 'Flywoo',
    mcu: 'STM32F405',
    category: 'mini-fc',
    boardIds: [1137],
  },
  {
    name: 'FlywooF745',
    displayName: 'Flywoo F745',
    vendor: 'Flywoo',
    mcu: 'STM32F745',
    category: 'mini-fc',
    boardIds: [1027],
  },

  // ── iFlight ───────────────────────────────────────────────
  {
    name: 'BeastF7',
    displayName: 'iFlight Beast F7',
    vendor: 'iFlight',
    mcu: 'STM32F745',
    category: 'mini-fc',
    boardIds: [1026],
  },
  {
    name: 'BeastH7',
    displayName: 'iFlight Beast H7',
    vendor: 'iFlight',
    mcu: 'STM32H743',
    category: 'mini-fc',
    boardIds: [1025],
  },

  // ── Foxeer ────────────────────────────────────────────────
  {
    name: 'FoxeerH743V1',
    displayName: 'Foxeer H743 V1',
    vendor: 'Foxeer',
    mcu: 'STM32H743',
    category: 'mini-fc',
    boardIds: [1089],
  },

  // ── Generic / Popular boards ──────────────────────────────
  {
    name: 'OmnibusF4',
    displayName: 'Omnibus F4',
    vendor: 'Airbot',
    mcu: 'STM32F405',
    category: 'mini-fc',
    boardIds: [1002],
  },
  {
    name: 'KakuteF4',
    displayName: 'Kakute F4',
    vendor: 'Holybro',
    mcu: 'STM32F405',
    category: 'mini-fc',
    boardIds: [122],
  },
  {
    name: 'f4by',
    displayName: 'Swift F4BY',
    vendor: 'Swift',
    mcu: 'STM32F407',
    category: 'mini-fc',
    boardIds: [20],
  },
  {
    name: 'MambaF405-2022',
    displayName: 'Mamba F405 2022',
    vendor: 'Diatone',
    mcu: 'STM32F405',
    category: 'mini-fc',
    boardIds: [1038],
  },
  {
    name: 'MambaH743v4',
    displayName: 'Mamba H743 V4',
    vendor: 'Diatone',
    mcu: 'STM32H743',
    category: 'mini-fc',
    boardIds: [1073],
  },

  // ── Linux boards ──────────────────────────────────────────
  {
    name: 'linux',
    displayName: 'Linux (Generic)',
    vendor: 'Generic',
    mcu: 'Linux',
    category: 'linux',
    // Linux builds report no board id in AUTOPILOT_VERSION.
    boardIds: [],
  },
  {
    name: 'navigator',
    displayName: 'Blue Robotics Navigator',
    vendor: 'Blue Robotics',
    mcu: 'Linux (RPi)',
    category: 'linux',
    boardIds: [],
  },
  {
    name: 'Pixhawk1-1M',
    displayName: 'Pixhawk 1 (1M)',
    vendor: 'mRo',
    mcu: 'STM32F427',
    category: 'pixhawk',
    // Runs the FMUv3 build and reports board id 9, the same as CubeBlack.
    boardIds: [],
  },
  {
    name: 'Pixhawk1-1M-bdshot',
    displayName: 'Pixhawk 1 (BDShot)',
    vendor: 'mRo',
    mcu: 'STM32F427',
    category: 'pixhawk',
    // Runs the FMUv3 build and reports board id 9, the same as CubeBlack.
    boardIds: [],
  },

  // ── Generic F405 fallback ─────────────────────────────────
  {
    name: 'GenericF405',
    displayName: 'Generic F405',
    vendor: 'Generic',
    mcu: 'STM32F405',
    category: 'other',
    boardIds: [],
    outputCount: 8,
    timerGroups: [[1, 2], [3, 4], [5, 6], [7, 8]],
    outputNotes: {},
    protocols: ['Both', 'Both', 'Both', 'Both'],
  },
]

// ── Lookup indexes ──────────────────────────────────────────

const _boardIdIndex = new Map<number, ArduPilotBoardEntry>()
for (const entry of ARDUPILOT_BOARDS) {
  for (const id of entry.boardIds) {
    _boardIdIndex.set(id, entry)
  }
}

/** Find an ArduPilot board entry by AP_FW_BOARD_ID. */
export function findArduPilotBoard(boardId: number): ArduPilotBoardEntry | undefined {
  return _boardIdIndex.get(boardId)
}

// ── Vendor inference for unregistered boards ────────────────

const VENDOR_PATTERNS: [RegExp, string][] = [
  [/^SpeedyBee/i, 'SpeedyBee'],
  [/^Matek/i, 'Matek'],
  [/^Pixhawk/i, 'Holybro'],
  [/^Kakute/i, 'Holybro'],
  [/^Durandal/i, 'Holybro'],
  [/^Cube/i, 'CubePilot'],
  [/^CUAV/i, 'CUAV'],
  [/^mRo/i, 'mRo'],
  [/^Flywoo/i, 'Flywoo'],
  [/^iFlight|^Beast/i, 'iFlight'],
  [/^Foxeer/i, 'Foxeer'],
  [/^Mamba|^Diatone/i, 'Diatone'],
  [/^Omnibus/i, 'Airbot'],
  [/^JHEMCU/i, 'JHEMCU'],
  [/^Aocoda/i, 'Aocoda'],
  [/^SkystarsH7/i, 'Skystars'],
]

const MCU_PATTERNS: [RegExp, string][] = [
  [/H743|H753/i, 'STM32H743'],
  [/H757/i, 'STM32H757'],
  [/F765/i, 'STM32F765'],
  [/F745|F7[^0-9]/i, 'STM32F745'],
  [/F427|F4[^0-9]*Pro/i, 'STM32F427'],
  [/F405/i, 'STM32F405'],
  [/F303/i, 'STM32F303'],
]

/** Infer vendor and MCU from a board name string (e.g., "MatekH743" -> Matek, STM32H743). */
export function inferBoardMetadata(boardName: string): { vendor: string; mcu: string } {
  let vendor = 'Unknown'
  let mcu = 'Unknown'

  for (const [pattern, v] of VENDOR_PATTERNS) {
    if (pattern.test(boardName)) {
      vendor = v
      break
    }
  }

  for (const [pattern, m] of MCU_PATTERNS) {
    if (pattern.test(boardName)) {
      mcu = m
      break
    }
  }

  return { vendor, mcu }
}

/** Get all unique vendors from the registry. */
export function getArduPilotVendors(): string[] {
  const vendors = new Set(ARDUPILOT_BOARDS.map((b) => b.vendor))
  return Array.from(vendors).sort()
}

/** Group boards by vendor. */
export function groupArduPilotBoardsByVendor(): Map<string, ArduPilotBoardEntry[]> {
  const map = new Map<string, ArduPilotBoardEntry[]>()
  for (const board of ARDUPILOT_BOARDS) {
    const list = map.get(board.vendor) ?? []
    list.push(board)
    map.set(board.vendor, list)
  }
  return map
}
