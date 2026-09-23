/**
 * Setpoint rates for each Betaflight rates_type, checked against values
 * worked by hand from the firmware's applyRates functions.
 */

import { describe, expect, it } from "vitest";
import { applyRates, RATES_TYPE, type AxisRates } from "../rate-curve-preview";

const axis = (rcRate: number, expo: number, superRate: number, rateLimit = 1998): AxisRates =>
  ({ rcRate, expo, superRate, rateLimit });

describe("applyRates", () => {
  it("Actual: firmware default profile reaches 670 deg/s", () => {
    const r = axis(7, 0, 67);
    expect(applyRates(RATES_TYPE.ACTUAL, r, 1)).toBeCloseTo(670, 6);
    expect(applyRates(RATES_TYPE.ACTUAL, r, 0.5)).toBeCloseTo(185, 6);
    expect(applyRates(RATES_TYPE.ACTUAL, r, -1)).toBeCloseTo(-670, 6);
  });

  it("Betaflight: super rate factor", () => {
    expect(applyRates(RATES_TYPE.BETAFLIGHT, axis(100, 0, 70), 1)).toBeCloseTo(200 / 0.3, 6);
  });

  it("Betaflight: applies expo as rcCommand * |x|^3", () => {
    // 0.5 * 0.125 * 0.5 + 0.5 * 0.5 = 0.28125 -> 200 * 0.28125
    expect(applyRates(RATES_TYPE.BETAFLIGHT, axis(100, 50, 0), 0.5)).toBeCloseTo(56.25, 6);
  });

  it("Betaflight: rc rate above 2.0 uses the incremental scale", () => {
    expect(applyRates(RATES_TYPE.BETAFLIGHT, axis(250, 0, 0), 1)).toBeCloseTo(200 * (2.5 + 14.54 * 0.5), 3);
  });

  it("Betaflight: super rate 100 stays finite and is capped by the rate limit", () => {
    const v = applyRates(RATES_TYPE.BETAFLIGHT, axis(100, 0, 100), 1);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBe(1998);
  });

  it("Quick, KISS and RaceFlight", () => {
    expect(applyRates(RATES_TYPE.QUICK, axis(100, 0, 67), 1)).toBeCloseTo(670, 3);
    expect(applyRates(RATES_TYPE.KISS, axis(100, 0, 70), 1)).toBeCloseTo(2000 * (1 / 0.3) * 0.1, 3);
    expect(applyRates(RATES_TYPE.RACEFLIGHT, axis(37, 0, 80), 1)).toBeCloseTo(666, 6);
  });

  it("honours the per-axis rate limit", () => {
    expect(applyRates(RATES_TYPE.ACTUAL, axis(7, 0, 67, 500), 1)).toBe(500);
  });
});
