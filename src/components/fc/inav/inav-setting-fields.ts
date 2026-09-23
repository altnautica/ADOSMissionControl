/**
 * @module inav-setting-fields
 * @description Read and write groups of iNav named settings together with the
 * range the connected firmware reports for each (MSP2_COMMON_SETTING_INFO).
 * Writes refuse values outside that range and fail on the first setting the
 * FC refuses, so a panel never shows a rejected write as saved.
 * @license GPL-3.0-only
 */

import type { SettingsCapability } from "@/lib/protocol/types";
import { settingNumber } from "@/lib/protocol/types";

export interface SettingRange {
  min: number;
  max: number;
}

export interface SettingSpec<K extends string> {
  key: K;
  /** iNav setting name. */
  name: string;
  /** A setting some firmware builds lack; a failed read leaves it out. */
  optional?: boolean;
}

/** Values and firmware ranges of a group of settings, keyed by panel field. */
export interface SettingGroup<K extends string> {
  values: Partial<Record<K, number>>;
  ranges: Partial<Record<K, SettingRange>>;
}

export function emptySettingGroup<K extends string>(): SettingGroup<K> {
  return { values: {}, ranges: {} };
}

/** Read each setting's value and range. A required setting that fails fails the read. */
export async function readSettingGroup<K extends string>(
  settings: SettingsCapability,
  specs: readonly SettingSpec<K>[],
): Promise<SettingGroup<K>> {
  const group = emptySettingGroup<K>();
  for (const spec of specs) {
    try {
      const info = await settings.getSettingInfo(spec.name);
      const value = settingNumber(await settings.getSetting(spec.name));
      group.values[spec.key] = value;
      group.ranges[spec.key] = { min: info.min, max: info.max };
    } catch (err) {
      if (!spec.optional) throw err;
    }
  }
  return group;
}

/** Why a value cannot be written, or null when it is inside the firmware range. */
export function rangeError(value: number, range: SettingRange | undefined): string | null {
  if (!range) return null;
  if (!Number.isFinite(value)) return "not a number";
  if (value < range.min || value > range.max) return `must be ${range.min} to ${range.max}`;
  return null;
}

/**
 * Write every setting the group holds. All values are range-checked first, so
 * nothing is written when any one is out of range; the first refused write
 * throws with the FC's message.
 */
export async function writeSettingGroup<K extends string>(
  settings: SettingsCapability,
  specs: readonly SettingSpec<K>[],
  group: SettingGroup<K>,
): Promise<void> {
  const present = specs.filter((s) => group.values[s.key] !== undefined);
  for (const spec of present) {
    const problem = rangeError(group.values[spec.key]!, group.ranges[spec.key]);
    if (problem) throw new Error(`${spec.name} ${problem}`);
  }
  for (const spec of present) {
    const result = await settings.setSetting(spec.name, group.values[spec.key]!);
    if (!result.success) throw new Error(`${spec.name}: ${result.message}`);
  }
}

export interface EnumOption {
  value: string;
  label: string;
}

/**
 * Select options for an enum setting. A stored value the table does not know
 * is listed as its raw number, so the Select never shows a blank as FC state.
 */
export function enumOptionsFor(options: readonly EnumOption[], value: number | undefined): EnumOption[] {
  if (value === undefined || options.some((o) => o.value === String(value))) return [...options];
  return [...options, { value: String(value), label: `${value} (unknown)` }];
}
