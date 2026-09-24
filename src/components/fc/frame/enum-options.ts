/**
 * @module fc/frame/enum-options
 * @description Option lists for firmware enum parameters. A vehicle can
 * report a value the list does not name (a newer firmware, a custom build);
 * that value stays selectable as-is instead of the picker snapping to a
 * neighbouring entry or showing blank.
 * @license GPL-3.0-only
 */

export interface EnumOption {
  value: string;
  label: string;
}

export function withCurrent(
  options: readonly EnumOption[],
  current: number | undefined,
): EnumOption[] {
  if (current === undefined || options.some((o) => o.value === String(current))) {
    return [...options];
  }
  return [...options, { value: String(current), label: `${current} — Unrecognised` }];
}
