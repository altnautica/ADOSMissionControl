/**
 * @module use-local-frame-data-follow.test
 * @description The local map's follow target, as the shared rule places it:
 * dashed with its search area, vantage point and predicted path while sought,
 * plain while following, and gone while follow-me holds for the operator.
 * @license GPL-3.0-only
 */

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { followState } from "@/components/cockpit/__tests__/follow-fixtures";
import { useLocalFrameData } from "@/components/map/local/use-local-frame-data";
import type { FollowState } from "@/lib/hud/nav-types";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "node:local-frame-follow";

const RECOVERY: Partial<FollowState> = {
  targetNed: [5, 0],
  targetVelNed: [0, 1],
  searchArea: { centerNe: [5, 0], semiMajorM: 3, semiMinorM: 1.5, headingDeg: 90 },
  predictedPathNe: [
    [5, 0],
    [5, 1],
  ],
  vantageNe: [2, -2],
};

function target(phase: FollowState["phase"]) {
  useNavStreamStore.getState().setFollow(DRONE, followState({ ...RECOVERY, phase }));
  return renderHook(() => useLocalFrameData(DRONE)).result.current.target;
}

describe("useLocalFrameData: the follow target", () => {
  beforeEach(() => useNavStreamStore.getState().clear(DRONE));
  afterEach(cleanup);

  it("carries the search area, vantage point and predicted path while searching", () => {
    expect(target("searching")).toMatchObject({
      north: 5,
      east: 0,
      dashed: true,
      searchArea: RECOVERY.searchArea,
      vantageNe: [2, -2],
      predictedPath: RECOVERY.predictedPathNe,
    });
  });

  it("is plain while following and absent while holding for the operator", () => {
    expect(target("following")).toMatchObject({ dashed: false, searchArea: null, vantageNe: null, predictedPath: null });
    expect(target("holding-await-operator")).toBeNull();
  });
});
