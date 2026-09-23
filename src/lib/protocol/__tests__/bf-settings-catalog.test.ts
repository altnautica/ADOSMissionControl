/**
 * Regression guard for the committed Betaflight settings catalog
 * (`public/param-metadata/bf-settings-<ver>.json.gz`, produced by
 * `scripts/param-metadata/bf-settings.mjs`). Asserts the catalog is complete
 * and carries firmware-sourced enum labels, so a parse regression in the
 * generator can never silently ship an empty or mislabelled catalog.
 *
 * @module protocol/bf-settings-catalog.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const DIR = join(process.cwd(), "public", "param-metadata");
const file = readdirSync(DIR).find((f) => /^bf-settings-.+\.json\.gz$/.test(f));

describe("Betaflight settings catalog", () => {
  it("ships a committed bf-settings-<ver>.json.gz", () => {
    expect(file, "no bf-settings-*.json.gz found — run scripts/param-metadata/bf-settings.mjs").toBeDefined();
  });

  const snap = file
    ? (JSON.parse(gunzipSync(readFileSync(join(DIR, file))).toString("utf8")) as {
        provenance: { firmware: string; version: string; paramCount: number };
        params: Array<{ name: string; valueType?: string; values?: [number, string][]; range?: { min: number; max: number } }>;
      })
    : null;

  it("has the full ~810-setting surface (not a stub)", () => {
    expect(snap!.provenance.firmware).toBe("betaflight");
    expect(snap!.params.length).toBeGreaterThanOrEqual(700);
    expect(snap!.provenance.paramCount).toBe(snap!.params.length);
  });

  it("carries firmware-sourced enum labels for anchor settings", () => {
    const by = new Map(snap!.params.map((p) => [p.name, p]));
    const labels = (n: string) => (by.get(n)?.values ?? []).map(([, l]) => l);
    expect(labels("gyro_hardware_lpf")).toContain("NORMAL");
    expect(labels("motor_pwm_protocol")).toContain("DSHOT600");
    expect(labels("serialrx_provider")).toContain("CRSF");
    expect(labels("failsafe_procedure")).toContain("GPS-RESCUE");
  });

  it("never ships an empty-label enum (omit, don't guess)", () => {
    for (const p of snap!.params) {
      if (p.values) {
        expect(p.values.length, `${p.name} has an empty values table`).toBeGreaterThan(0);
        for (const [, label] of p.values) expect(label).toBeTruthy();
      }
    }
  });

  it("carries typed ranges for direct numeric settings", () => {
    const by = new Map(snap!.params.map((p) => [p.name, p]));
    expect(by.get("gyro_lpf1_static_hz")?.valueType).toBe("uint16");
    expect(snap!.params.filter((p) => p.range).length).toBeGreaterThan(100);
  });
});
