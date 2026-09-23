/**
 * PX4 board name mapping — static display names + vendor/category for PX4 boards.
 *
 * PX4 board names come from GitHub release asset filenames (e.g., "px4_fmu-v5x_default").
 * This module maps the board key (filename prefix before "_default") to display metadata.
 *
 * @license GPL-3.0-only
 */

import type { PX4Board } from "@/lib/protocol/firmware/types";
import type { SelectOptionGroup } from "@/lib/types";

export interface PX4BoardMeta {
  displayName: string
  vendor: string
  category: string
}

/** Static mapping of PX4 board name prefixes to display metadata. */
export const PX4_BOARD_MAP: Record<string, PX4BoardMeta> = {
  // Holybro Pixhawk series
  'px4_fmu-v2': { displayName: 'Pixhawk 1', vendor: 'Holybro', category: 'Pixhawk' },
  'px4_fmu-v3': { displayName: 'Pixhawk 2 (Cube)', vendor: 'CubePilot', category: 'Pixhawk' },
  'px4_fmu-v4': { displayName: 'Pixracer', vendor: 'mRo', category: 'Pixhawk' },
  'px4_fmu-v4pro': { displayName: 'Pixhawk 3 Pro', vendor: 'Drotek', category: 'Pixhawk' },
  'px4_fmu-v5': { displayName: 'Pixhawk 4', vendor: 'Holybro', category: 'Pixhawk' },
  'px4_fmu-v5x': { displayName: 'Pixhawk 4X', vendor: 'Holybro', category: 'Pixhawk' },
  'px4_fmu-v6c': { displayName: 'Pixhawk 6C', vendor: 'Holybro', category: 'Pixhawk' },
  'px4_fmu-v6x': { displayName: 'Pixhawk 6X', vendor: 'Holybro', category: 'Pixhawk' },
  'px4_fmu-v6xrt': { displayName: 'Pixhawk 6X-RT', vendor: 'Holybro', category: 'Pixhawk' },

  // Holybro other
  'holybro_durandal-v1': { displayName: 'Durandal V1', vendor: 'Holybro', category: 'Holybro' },
  'holybro_kakutef7': { displayName: 'Kakute F7', vendor: 'Holybro', category: 'Holybro' },
  'holybro_kakuteh7': { displayName: 'Kakute H7', vendor: 'Holybro', category: 'Holybro' },
  'holybro_kakuteh7mini': { displayName: 'Kakute H7 Mini', vendor: 'Holybro', category: 'Holybro' },
  'holybro_kakuteh7v2': { displayName: 'Kakute H7 V2', vendor: 'Holybro', category: 'Holybro' },

  // CUAV
  'cuav_nora': { displayName: 'CUAV Nora', vendor: 'CUAV', category: 'CUAV' },
  'cuav_x7pro': { displayName: 'CUAV X7 Pro', vendor: 'CUAV', category: 'CUAV' },
  'cuav_x7pro-v1': { displayName: 'CUAV X7 Pro V1', vendor: 'CUAV', category: 'CUAV' },
  'cuav_7-nano': { displayName: 'CUAV V5 Nano', vendor: 'CUAV', category: 'CUAV' },
  'cuav_can-gps-v1': { displayName: 'CUAV CAN GPS V1', vendor: 'CUAV', category: 'CUAV' },

  // CubePilot
  'cubepilot_cubeorange': { displayName: 'CubeOrange', vendor: 'CubePilot', category: 'CubePilot' },
  'cubepilot_cubeyellow': { displayName: 'CubeYellow', vendor: 'CubePilot', category: 'CubePilot' },

  // mRo
  'mro_ctrl-zero-f7': { displayName: 'Control Zero F7', vendor: 'mRo', category: 'mRo' },
  'mro_ctrl-zero-h7': { displayName: 'Control Zero H7', vendor: 'mRo', category: 'mRo' },
  'mro_ctrl-zero-h7-oem': { displayName: 'Control Zero H7 OEM', vendor: 'mRo', category: 'mRo' },
  'mro_pixracerpro': { displayName: 'Pixracer Pro', vendor: 'mRo', category: 'mRo' },
  'mro_x2.1-777': { displayName: 'X2.1-777', vendor: 'mRo', category: 'mRo' },

  // ARK
  'ark_fmu-v6x': { displayName: 'ARK FMU V6X', vendor: 'ARK', category: 'ARK' },
  'ark_pi6x': { displayName: 'ARK Pi6X', vendor: 'ARK', category: 'ARK' },
  'ark_cannode': { displayName: 'ARK CAN Node', vendor: 'ARK', category: 'ARK' },

  // Diatone / Mamba
  'diatone_mamba-f405-mk2': { displayName: 'Mamba F405 MK2', vendor: 'Diatone', category: 'Mini FC' },
  'diatone_mamba-h743-mk4': { displayName: 'Mamba H743 MK4', vendor: 'Diatone', category: 'Mini FC' },

  // Boards that don't match a known prefix get vendor/category inferred
  'nxp_fmuk66-v3': { displayName: 'NXP FMUK66 V3', vendor: 'NXP', category: 'NXP' },
  'nxp_fmurt1062-v1': { displayName: 'NXP FMURT1062', vendor: 'NXP', category: 'NXP' },

  // Simulation
  'px4_sitl_default': { displayName: 'SITL (Simulation)', vendor: 'PX4', category: 'Simulation' },
}

/** Resolve PX4 board display metadata. Falls back to name parsing. */
export function resolvePX4BoardMeta(boardName: string): PX4BoardMeta {
  // Try direct lookup first
  const key = boardName.replace(/_default$/, '')
  if (PX4_BOARD_MAP[key]) return PX4_BOARD_MAP[key]

  // Try without trailing version suffix
  const keyBase = key.replace(/-v\d+$/, '')
  if (PX4_BOARD_MAP[keyBase]) return PX4_BOARD_MAP[keyBase]

  // Infer from naming convention
  const vendor = inferPX4Vendor(boardName)
  return {
    displayName: boardName.replace(/_default$/, '').replace(/_/g, ' '),
    vendor,
    category: vendor,
  }
}

function inferPX4Vendor(name: string): string {
  if (name.startsWith('px4_fmu')) return 'Holybro'
  if (name.startsWith('holybro_')) return 'Holybro'
  if (name.startsWith('cuav_')) return 'CUAV'
  if (name.startsWith('cubepilot_')) return 'CubePilot'
  if (name.startsWith('mro_')) return 'mRo'
  if (name.startsWith('ark_')) return 'ARK'
  if (name.startsWith('diatone_')) return 'Diatone'
  if (name.startsWith('nxp_')) return 'NXP'
  if (name.startsWith('matek_')) return 'Matek'
  if (name.startsWith('modalai_')) return 'ModalAI'
  if (name.startsWith('sky_')) return 'Sky-Drones'
  return 'Other'
}

/** Build grouped Select options from PX4 boards, grouped by vendor/category. */
export function buildPX4SelectGroups(boards: PX4Board[]): SelectOptionGroup[] {
  const grouped = new Map<string, { board: PX4Board; meta: PX4BoardMeta }[]>()

  for (const board of boards) {
    const meta = resolvePX4BoardMeta(board.name)
    const category = meta.category
    const list = grouped.get(category) ?? []
    list.push({ board, meta })
    grouped.set(category, list)
  }

  const groups: SelectOptionGroup[] = []
  const sortedCategories = Array.from(grouped.keys()).sort()

  for (const category of sortedCategories) {
    const items = grouped.get(category) ?? []
    groups.push({
      label: category,
      options: items
        .sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName))
        .map(({ board, meta }) => ({
          value: board.name,
          label: meta.displayName,
          description: `${meta.vendor} / ${(board.size / 1024 / 1024).toFixed(1)} MB`,
        })),
    })
  }

  return groups
}
