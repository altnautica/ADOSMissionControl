import type { FollowState } from "@/lib/agent/nav-types";

/** A following-phase `follow.state` with every panel field filled in. */
export function followState(over: Partial<FollowState> = {}): FollowState {
  return {
    active: true,
    phase: "following",
    trackId: 12,
    confidence: 0.86,
    rangeM: 10.2,
    rangeSigmaM: 0.3,
    rangeCues: [
      { kind: "ground", rangeM: 10.1, sigmaM: 0.4 },
      { kind: "lidar", rangeM: 10.2, sigmaM: 0.1 },
    ],
    targetSpeedMps: 1.4,
    aglM: 4.1,
    aglSource: "rng",
    reacquireMode: "smart",
    coastRemainingS: null,
    pipelineLatencyMs: 85,
    holdReason: null,
    bearingDeg: 64,
    depressionDeg: 22,
    targetNed: null,
    targetVelNed: null,
    predictedBbox: null,
    ...over,
  };
}
