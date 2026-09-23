/**
 * PID log analysis belongs to one drone, and the bundled sample analysis is a
 * demo-mode fixture only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as UtilsModule from "@/lib/utils";

let demo = false;
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof UtilsModule>()),
  isDemoMode: () => demo,
}));

import { usePidAnalysisStore } from "@/stores/pid-analysis-store";
import type { AiRecommendation, PidAnalysisResult } from "@/lib/analysis/types";

const result = { metadata: { durationSec: 10 } } as unknown as PidAnalysisResult;
const rec = { id: "r1", param: "ATC_RAT_RLL_P", confidence: 90 } as unknown as AiRecommendation;

describe("PID analysis store drone scope", () => {
  beforeEach(() => {
    demo = false;
    usePidAnalysisStore.getState().bindDrone(null);
  });

  it("clears another drone's analysis, suggestions and comparison when the drone changes", () => {
    const store = usePidAnalysisStore.getState();
    store.bindDrone("drone-a");
    usePidAnalysisStore.setState({
      analysisResult: result,
      previousResult: result,
      aiRecommendations: [rec],
      aiSummary: "A",
      aiRemainingUses: 3,
    });

    usePidAnalysisStore.getState().bindDrone("drone-b");

    const s = usePidAnalysisStore.getState();
    expect(s.droneId).toBe("drone-b");
    expect(s.analysisResult).toBeNull();
    expect(s.previousResult).toBeNull();
    expect(s.aiRecommendations).toEqual([]);
    expect(s.aiSummary).toBe("");
    // Usage quota is per account, not per drone.
    expect(s.aiRemainingUses).toBe(3);
  });

  it("keeps the analysis when the same drone's panel mounts again", () => {
    usePidAnalysisStore.getState().bindDrone("drone-a");
    usePidAnalysisStore.setState({ analysisResult: result });
    usePidAnalysisStore.getState().bindDrone("drone-a");
    expect(usePidAnalysisStore.getState().analysisResult).toBe(result);
  });

  it("does not load the sample analysis outside demo mode", () => {
    usePidAnalysisStore.getState().loadMockAnalysis();
    const s = usePidAnalysisStore.getState();
    expect(s.analyzing).toBe(false);
    expect(s.aiRecommendations).toEqual([]);
    expect(s.logFileName).toBeNull();
  });
});
