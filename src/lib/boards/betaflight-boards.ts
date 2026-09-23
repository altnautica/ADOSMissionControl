/**
 * Betaflight board catalog — grouping wrapper over Cloud Build API data.
 *
 * The BF Cloud API already returns manufacturer, mcu, and group per target.
 * This module provides grouping/lookup utilities on top of that data.
 *
 * @license GPL-3.0-only
 */

import type { BetaflightTarget } from "@/lib/protocol/firmware/types";
import type { SelectOptionGroup } from "@/lib/types";

export interface BetaflightBoardCatalog {
  targets: BetaflightTarget[]
  byManufacturer: Map<string, BetaflightTarget[]>
  byMcuGroup: Map<string, BetaflightTarget[]>
}

/** Build grouped catalog from BF Cloud API target list. */
export function buildBetaflightCatalog(targets: BetaflightTarget[]): BetaflightBoardCatalog {
  const byManufacturer = new Map<string, BetaflightTarget[]>()
  const byMcuGroup = new Map<string, BetaflightTarget[]>()

  for (const t of targets) {
    const mfr = t.manufacturer || 'Unknown'
    const mcu = t.group || t.mcu || 'Unknown'

    const mfrList = byManufacturer.get(mfr) ?? []
    mfrList.push(t)
    byManufacturer.set(mfr, mfrList)

    const mcuList = byMcuGroup.get(mcu) ?? []
    mcuList.push(t)
    byMcuGroup.set(mcu, mcuList)
  }

  return { targets, byManufacturer, byMcuGroup }
}

/** Build grouped Select options from BF targets, grouped by manufacturer. */
export function buildBetaflightSelectGroups(targets: BetaflightTarget[]): SelectOptionGroup[] {
  const catalog = buildBetaflightCatalog(targets)
  const groups: SelectOptionGroup[] = []

  const sortedManufacturers = Array.from(catalog.byManufacturer.keys()).sort()

  for (const mfr of sortedManufacturers) {
    const mfrTargets = catalog.byManufacturer.get(mfr) ?? []
    groups.push({
      label: mfr,
      options: mfrTargets
        .sort((a, b) => a.target.localeCompare(b.target))
        .map((t) => ({
          value: t.target,
          label: t.target,
          description: `${t.mcu}${t.group ? ` / ${t.group}` : ''}`,
        })),
    })
  }

  return groups
}
