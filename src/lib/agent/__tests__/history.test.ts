/**
 * @module history.test
 * @description Unit tests for the bounded utilisation-history series. The
 * behaviour under test is that an absent reading contributes no data point, so
 * a chart never shows a dip the node did not report.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { appendHistorySample } from "../history";

describe("appendHistorySample", () => {
  it("appends a reported sample", () => {
    expect(appendHistorySample([10, 20], 30, 60)).toEqual([10, 20, 30]);
  });

  it("appends a genuine zero, which is a real measurement", () => {
    expect(appendHistorySample([10], 0, 60)).toEqual([10, 0]);
  });

  it("appends nothing when the reading is absent", () => {
    // A heartbeat with no resource block is not a measurement of zero load.
    expect(appendHistorySample([10, 20], undefined, 60)).toEqual([10, 20]);
  });

  it("appends nothing for a NaN reading", () => {
    expect(appendHistorySample([10], Number.NaN, 60)).toEqual([10]);
  });

  it("returns the same reference when nothing was appended", () => {
    const history = [10, 20];
    expect(appendHistorySample(history, undefined, 60)).toBe(history);
  });

  it("does not mutate the input when appending", () => {
    const history = [10, 20];
    appendHistorySample(history, 30, 60);
    expect(history).toEqual([10, 20]);
  });

  it("drops the oldest sample once the series is full", () => {
    expect(appendHistorySample([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  it("trims a series that was already over the bound", () => {
    expect(appendHistorySample([1, 2, 3, 4], 5, 3)).toEqual([3, 4, 5]);
  });

  it("does not trim an over-long series when the reading is absent", () => {
    // Nothing was measured, so nothing about the series should change.
    const history = [1, 2, 3, 4];
    expect(appendHistorySample(history, undefined, 3)).toBe(history);
  });
});
