/**
 * @module check-compatibility.test
 * @description Unit coverage for the install review compatibility
 * helper. Confirms the wildcard pass-through, the SoC fallback, the
 * RAM check, and the CPU peak warning.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { checkCompatibility } from "../check-compatibility";
import type { InstallManifestSummary } from "../types";

const base: InstallManifestSummary = {
  pluginId: "demo",
  version: "0.1.0",
  name: "Demo",
  halves: ["agent"],
  signatureState: "unsigned",
  trustSignals: [],
  permissions: [],
};

describe("checkCompatibility", () => {
  it("passes when manifest declares no boards (wildcard)", () => {
    const r = checkCompatibility(base, {
      boardModel: "rock-5c-lite",
      boardSoc: "rk3582",
      ramTotalMb: 16000,
    });
    expect(r.boardCompatible).toBe(true);
    expect(r.ramOk).toBe(true);
    expect(r.cpuOk).toBe(true);
  });

  it("passes when one of the host's identifiers matches a declared board", () => {
    const r = checkCompatibility(
      { ...base, hardwareRequirements: { boards: ["rk3582"] } },
      { boardModel: "rock-5c-lite", boardSoc: "rk3582" },
    );
    expect(r.boardCompatible).toBe(true);
  });

  it("fails when no identifier matches the declared list", () => {
    const r = checkCompatibility(
      { ...base, hardwareRequirements: { boards: ["jetson-orin-nano"] } },
      { boardModel: "rock-5c-lite", boardSoc: "rk3582" },
    );
    expect(r.boardCompatible).toBe(false);
    expect(r.boardReason).toBe("rock-5c-lite");
  });

  it("stays optimistic when host board signals are missing", () => {
    const r = checkCompatibility(
      { ...base, hardwareRequirements: { boards: ["rk3582"] } },
      {},
    );
    expect(r.boardCompatible).toBe(true);
  });

  it("flags RAM shortfall", () => {
    const r = checkCompatibility(
      { ...base, resourceImpact: { ramMb: 8000 } },
      { ramTotalMb: 1024 },
    );
    expect(r.ramOk).toBe(false);
    expect(r.ramReason).toContain("1024");
  });

  it("flags CPU peak at or above 90%", () => {
    const r = checkCompatibility(
      { ...base, resourceImpact: { cpuPercentPeak: 95 } },
      { ramTotalMb: 4000 },
    );
    expect(r.cpuOk).toBe(false);
    expect(r.cpuReason).toContain("95");
  });
});
