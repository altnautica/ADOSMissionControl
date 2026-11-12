/**
 * @module cockpit/carried-drone-name.test
 * @description The ground-station cockpit names the carried drone by the
 * operator's profile name, the row label, or the registry presence name before
 * falling back to its device id.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { carriedDroneName } from "../GroundStationCockpit";
import type { NodeEntry } from "@/stores/node-registry";

function registry(deviceId: string, name: string): Record<string, NodeEntry> {
  return {
    "node:x": { presence: { deviceId, name } } as unknown as NodeEntry,
  };
}

describe("carriedDroneName", () => {
  it("uses the registry presence name before the device id", () => {
    expect(carriedDroneName("romeo-15", undefined, undefined, registry("romeo-15", "Romeo"))).toBe(
      "Romeo",
    );
  });

  it("prefers the profile name, then the row label", () => {
    const nodes = registry("romeo-15", "Romeo");
    expect(carriedDroneName("romeo-15", "Survey", "Lbl", nodes)).toBe("Survey");
    expect(carriedDroneName("romeo-15", " ", "Lbl", nodes)).toBe("Lbl");
  });

  it("falls back to the device id when nothing names it", () => {
    expect(carriedDroneName("romeo-15", undefined, undefined, registry("other", "Other"))).toBe(
      "romeo-15",
    );
    expect(carriedDroneName("romeo-15", undefined, undefined, registry("romeo-15", ""))).toBe(
      "romeo-15",
    );
  });
});
