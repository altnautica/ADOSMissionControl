/**
 * @module fc/shared/param-enum-fallbacks
 * @description Enum and bitmask tables for the FC configuration panels.
 *
 * Panels render enum params from the connected firmware's parameter metadata
 * (`useParamMetadataMap`), which is keyed by vehicle, so ArduCopter, ArduPlane
 * and PX4 each get their own meaning for the same number. The tables in
 * `param-enum-fallbacks.json` are only the floor used while that metadata is
 * absent. Every entry is a verbatim copy of the firmware's `@Values` /
 * `@Bitmask` for that param, and a test cross-checks each one against the
 * snapshots under `public/param-metadata/`, so the floor cannot drift from
 * the metadata the panels normally use.
 *
 * Scopes: `ardupilot` holds library params whose values are identical on every
 * ArduPilot vehicle; `ardupilot-<vehicle>` holds vehicle-specific enums; `px4`
 * holds PX4-native params.
 * @license GPL-3.0-only
 */

import type { FirmwareType } from "@/lib/protocol/types";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import tables from "./param-enum-fallbacks.json";

export type EnumEntries = ReadonlyArray<readonly [number, string]>;

export interface FallbackScope {
  values?: Record<string, EnumEntries>;
  bitmask?: Record<string, EnumEntries>;
}

export type FallbackKind = keyof FallbackScope;

/** The raw fallback tables, keyed by scope. Exported for the cross-check test. */
export const PARAM_ENUM_FALLBACKS = tables as unknown as Record<string, FallbackScope>;

const EMPTY: ReadonlyMap<number, string> = new Map();

/**
 * Collapse an instanced param onto the one representative name its table is
 * stored under (every instance shares the same `@Values`). `SERIAL0_PROTOCOL`
 * is not collapsed: the USB console only accepts the two MAVLink values.
 */
export function fallbackParamKey(name: string): string {
  if (/^RC\d+_OPTION$/.test(name)) return "RC1_OPTION";
  if (name === "SERIAL0_BAUD") return "SERIAL1_BAUD";
  const serial = /^SERIAL[1-9]_(PROTOCOL|BAUD)$/.exec(name);
  if (serial) return `SERIAL1_${serial[1]}`;
  const rng = /^RNGFND[1-9A]_(TYPE|ORIENT)$/.exec(name);
  if (rng) return `RNGFND1_${rng[1]}`;
  const batt = /^BATT\d?_FS_(LOW|CRT)_ACT$/.exec(name);
  if (batt) return `BATT_FS_${batt[1]}_ACT`;
  if (/^BATT\d?_MONITOR$/.test(name)) return "BATT_MONITOR";
  return name;
}

function scopesFor(firmwareType: FirmwareType | null | undefined): string[] {
  if (!firmwareType) return [];
  return firmwareType.startsWith("ardupilot-") ? [firmwareType, "ardupilot"] : [firmwareType];
}

const tableCache = new Map<string, ReadonlyMap<number, string>>();

/** Fallback table for a firmware-native param name, or null when none exists. */
export function fallbackTable(
  kind: FallbackKind,
  nativeName: string,
  firmwareType: FirmwareType | null | undefined,
): ReadonlyMap<number, string> | null {
  const key = fallbackParamKey(nativeName);
  for (const scope of scopesFor(firmwareType)) {
    const entries = PARAM_ENUM_FALLBACKS[scope]?.[kind]?.[key];
    if (!entries) continue;
    const cacheKey = `${scope}/${kind}/${key}`;
    let table = tableCache.get(cacheKey);
    if (!table) {
      table = new Map(entries);
      tableCache.set(cacheKey, table);
    }
    return table;
  }
  return null;
}

/**
 * Enum values for a param: the firmware metadata when it carries any, else
 * the fallback table, else an empty map (the select then shows the raw value).
 */
export function resolveParamEnum(
  nativeName: string,
  metadata: Map<string, ParamMetadata>,
  firmwareType: FirmwareType | null | undefined,
): ReadonlyMap<number, string> {
  const live = metadata.get(nativeName)?.values;
  if (live && live.size > 0) return live;
  return fallbackTable("values", nativeName, firmwareType) ?? EMPTY;
}

/** Bitmask bit index → label, resolved the same way as {@link resolveParamEnum}. */
export function resolveParamBitmask(
  nativeName: string,
  metadata: Map<string, ParamMetadata>,
  firmwareType: FirmwareType | null | undefined,
): ReadonlyMap<number, string> {
  const live = metadata.get(nativeName)?.bitmask;
  if (live && live.size > 0) return live;
  return fallbackTable("bitmask", nativeName, firmwareType) ?? EMPTY;
}
