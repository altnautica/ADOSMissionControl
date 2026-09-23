/**
 * @license GPL-3.0-only
 *
 * The summary shows "-" for metrics the log could not measure instead of a
 * number.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PidAnalysisSummary } from "../PidAnalysisSummary";
import { MOCK_PID_ANALYSIS_RESULT } from "@/mock/mock-pid-analysis";
import type { PidAnalysisResult, TrackingAxisResult } from "@/lib/analysis/types";

function unmeasured(axis: "roll" | "pitch" | "yaw"): TrackingAxisResult {
  return { axis, rmsError: null, phaseLagMs: null, score: null, desired: [], actual: [], error: [] };
}

describe("PidAnalysisSummary", () => {
  it("renders unmeasured metrics as '-'", () => {
    const result: PidAnalysisResult = {
      ...MOCK_PID_ANALYSIS_RESULT,
      tuneScore: null,
      fft: {
        roll: { ...MOCK_PID_ANALYSIS_RESULT.fft.roll, noiseFloorDb: null, peaks: [], spectrum: [] },
        pitch: { ...MOCK_PID_ANALYSIS_RESULT.fft.pitch, noiseFloorDb: null, peaks: [], spectrum: [] },
        yaw: { ...MOCK_PID_ANALYSIS_RESULT.fft.yaw, noiseFloorDb: null, peaks: [], spectrum: [] },
      },
      tracking: { roll: unmeasured("roll"), pitch: unmeasured("pitch"), yaw: unmeasured("yaw"), overallScore: null },
      issues: [],
    };
    const { container, getByText, getAllByText } = render(<PidAnalysisSummary result={result} />);

    // Tune score, noise level and three tracking axes
    expect(getAllByText("-")).toHaveLength(5);
    expect(getByText("no IMU data")).toBeTruthy();
    expect(getAllByText("no RATE data")).toHaveLength(3);
    expect(container.textContent).not.toMatch(/deg\/s RMS|dB avg/);
  });
});
