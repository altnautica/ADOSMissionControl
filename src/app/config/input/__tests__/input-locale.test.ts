/**
 * @license GPL-3.0-only
 *
 * Settings › Input reads in German: every `inputDevices.*` and
 * `appPages.configInput.*` string differs from English except words that are
 * the same in both languages (axis names, "Name", "Status", "Gamepad").
 */

import { describe, it, expect } from "vitest";

import en from "../../../../../locales/en.json";
import de from "../../../../../locales/de.json";

const SAME_IN_GERMAN = new Set([
  "roll", "pitch", "throttle", "yaw", "stickMode1", "stickMode2", "name", "status", "kindJoystick", "kindGamepad",
]);

function untranslated(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return Object.entries(a)
    .filter(([k, v]) => typeof v === "string" && b[k] === v && !SAME_IN_GERMAN.has(k))
    .map(([k]) => k);
}

describe("Settings › Input · German", () => {
  it("has no English left in the input namespaces", () => {
    expect(untranslated(en.inputDevices, de.inputDevices)).toEqual([]);
    expect(untranslated(en.appPages.configInput, de.appPages.configInput)).toEqual([]);
  });
});
