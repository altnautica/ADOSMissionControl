/**
 * @module cockpit/spec-strings
 * @description The shared cockpit text (`spec/setup-strings.json`, English):
 * flight-flow banners, launch, controls, voice prompts and the setup wizard.
 * Every surface renders the same keys, so the words match across Mission
 * Control, the Android GCS and the agent cockpit.
 *
 * @license GPL-3.0-only
 */

import strings from "@/lib/cockpit-spec/setup-strings.json";

const TABLE = strings.strings as Record<string, string>;

/** Whether the spec has text for `key`. */
export function hasSpecString(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLE, key);
}

/**
 * The spec text for `key` with `{name}` placeholders filled from `args`.
 * An unknown key renders as itself, so a missing string is visible rather
 * than blank; an unknown placeholder renders empty.
 */
export function specString(key: string, args?: Record<string, unknown>): string {
  const text = TABLE[key] ?? key;
  if (!args) return text;
  return text.replace(/\{([a-z0-9_]+)\}/gi, (_, name: string) => {
    const v = args[name];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * The spec text (`mav_result.<NAME>`) for a MAVLink command result name,
 * bare (`DENIED`) or prefixed (`MAV_RESULT_DENIED`), or null when the spec
 * names no text for it.
 */
export function mavResultText(name: string): string | null {
  const key = `mav_result.${name.replace(/^MAV_RESULT_/, "")}`;
  return hasSpecString(key) ? TABLE[key] : null;
}
