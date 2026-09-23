/**
 * Tuning suggestions only reach the PID panel through the safety check:
 * unknown params are refused, values stay inside the safe range, and each
 * step from the flight controller's value is bounded.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { validateSuggestion } from "@/lib/analysis/pid-safety";
import { usePidAnalysisStore, type SuggestionTarget } from "@/stores/pid-analysis-store";
import type { AiRecommendation } from "@/lib/analysis/types";

describe("validateSuggestion", () => {
  it("rejects a parameter with no safe range", () => {
    expect(validateSuggestion("SERVO1_FUNCTION", 33, 0, "copter").status).toBe("rejected");
    expect(validateSuggestion("ARMING_CHECK", 1, 0, "plane").status).toBe("rejected");
  });

  it("rejects a suggestion when the flight controller value is unknown", () => {
    expect(validateSuggestion("ATC_RAT_RLL_P", undefined, 0.12, "copter").status).toBe("rejected");
  });

  it("enforces the plane roll rate P range and step", () => {
    const check = validateSuggestion("RLL_RATE_P", 0.3, 3.0, "plane");
    expect(check.status).toBe("clamped");
    if (check.status === "rejected") return;
    expect(check.value).toBeCloseTo(0.35);
  });

  it("accepts a small in-range plane pitch rate change as given", () => {
    expect(validateSuggestion("PTCH_RATE_D", 0.004, 0.006, "plane")).toEqual({ status: "ok", value: 0.006 });
  });

  it("moves an out-of-range current value by at most maxDelta", () => {
    // Copter roll P range is 0.01..0.5 with a 0.05 step limit.
    const check = validateSuggestion("ATC_RAT_RLL_P", 0.8, 0.82, "copter");
    expect(check.status).toBe("clamped");
    if (check.status === "rejected") return;
    expect(Math.abs(check.value - 0.8)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(check.value).toBeLessThan(0.8);
  });

  it("limits a large D-term jump to one step", () => {
    const check = validateSuggestion("ATC_RAT_RLL_D", 0.004, 0.04, "copter");
    expect(check).toMatchObject({ status: "clamped", value: 0.009 });
  });
});

describe("applying recommendations", () => {
  const rec: AiRecommendation = {
    id: "rec-1",
    title: "Tune roll",
    explanation: "",
    priority: "important",
    confidence: 90,
    parameters: [
      { param: "ATC_RAT_RLL_P", currentValue: 0.135, suggestedValue: 1.35, delta: 1.215 },
      { param: "ATC_RAT_RLL_D", currentValue: 0.004, suggestedValue: 0.003, delta: -0.001 },
      { param: "BRD_SAFETY_DEFLT", currentValue: 1, suggestedValue: 0, delta: -1 },
    ],
  };

  let setLocalValue: Mock<(name: string, value: number) => void>;
  let target: SuggestionTarget;

  beforeEach(() => {
    usePidAnalysisStore.setState({ aiRecommendations: [rec] });
    setLocalValue = vi.fn<(name: string, value: number) => void>();
    target = {
      vehicleType: "copter",
      // The FC's value differs from the value the model echoed back.
      fcParams: new Map([
        ["ATC_RAT_RLL_P", 0.2],
        ["ATC_RAT_RLL_D", 0.004],
        ["BRD_SAFETY_DEFLT", 1],
      ]),
      setLocalValue,
    };
  });

  it("writes only validated values measured from the FC's value", () => {
    const summary = usePidAnalysisStore.getState().applyRecommendation("rec-1", target);
    expect(summary).toEqual({ applied: 1, clamped: 1, rejected: 1 });
    expect(setLocalValue.mock.calls).toEqual([
      ["ATC_RAT_RLL_P", 0.25],
      ["ATC_RAT_RLL_D", 0.003],
    ]);
  });

  it("applies the same checks on Apply All", () => {
    usePidAnalysisStore.getState().applyAllRecommended(target);
    expect(setLocalValue).not.toHaveBeenCalledWith("BRD_SAFETY_DEFLT", expect.anything());
    expect(setLocalValue).not.toHaveBeenCalledWith("ATC_RAT_RLL_P", 1.35);
  });
});
