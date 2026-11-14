/**
 * @module use-resolved-targets.test
 * @description The resolver hook feeds the vehicle yaw while the subject is
 * sought, so the off-frame bearing mark draws while moving to look as well as
 * while searching.
 * @license GPL-3.0-only
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { followState } from "@/components/cockpit/__tests__/follow-fixtures";
import { useResolvedTargets } from "@/hooks/use-resolved-targets";
import type { FollowPhase } from "@/lib/hud/nav-types";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const DRONE = "node:resolve-test";

function offFrameTag(phase: FollowPhase): string | undefined {
  useNavStreamStore.getState().setFollow(DRONE, followState({ phase, bearingDeg: 64, predictedBbox: null }));
  const { result } = renderHook(() =>
    useResolvedTargets({ droneId: DRONE, batch: undefined, cameraId: "cam-a", videoLost: false, cameraYawOffsetDeg: 0 }),
  );
  return result.current.resolved.items.find((it) => it.kind === "SEARCHING_OFFFRAME")?.topTag?.text;
}

describe("useResolvedTargets", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useDroneManager.setState({ selectedDroneId: DRONE });
    useTelemetryStore
      .getState()
      .pushAttitude({ timestamp: Date.now(), roll: 0, pitch: 0, yaw: 10, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0 });
  });
  afterEach(() => {
    useNavStreamStore.getState().clear(DRONE);
  });

  it("draws the bearing mark while repositioning with no predicted box", () => {
    expect(offFrameTag("repositioning")).toContain("064");
  });

  it("draws the bearing mark while searching with no predicted box", () => {
    expect(offFrameTag("searching")).toContain("064");
  });
});
