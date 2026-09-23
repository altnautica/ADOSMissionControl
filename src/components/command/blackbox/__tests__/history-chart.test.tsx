/**
 * @license GPL-3.0-only
 *
 * A Black Box aggregate bucket with no finite value is a gap. The latest
 * reading must come from the last real sample, never a fabricated 0.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";

import { HistoryChart } from "../HistoryChart";

afterEach(cleanup);

describe("HistoryChart", () => {
  it("reports the last finite sample, not a missing bucket as zero", () => {
    render(
      createElement(HistoryChart, {
        title: "CPU",
        gradientId: "g",
        color: "var(--alt-accent-primary)",
        points: [
          { ts: "t1", ts_us: 1_000_000, metric: "cpu", value: 42 },
          { ts: "t2", ts_us: 2_000_000, metric: "cpu", value: Number.NaN },
        ],
      }),
    );
    expect(screen.getByText("42.0%")).toBeTruthy();
    expect(screen.queryByText("0.0%")).toBeNull();
  });
});
