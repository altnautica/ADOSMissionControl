/**
 * @module use-follow-designation-sync.test
 * @description Follow-me's discrete events and the host designation: a loss
 * that holds for the operator keeps the designation (searching again seeks
 * the same subject), any other loss and a stop clear it.
 * @license GPL-3.0-only
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useFollowDesignationSync } from "@/hooks/use-follow-designation-sync";
import type { FollowEvent } from "@/lib/hud/nav-types";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";

const DRONE = "node:designation-sync";

function designate() {
  useSelectedTargetStore.getState().setDesignated({
    droneId: DRONE,
    cameraId: "main",
    trackId: 15,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    classLabel: "person",
    confidence: 0.9,
  });
}

function push(event: FollowEvent, at: number) {
  act(() => useNavStreamStore.getState().pushFollowEvent(DRONE, event, at));
}

describe("useFollowDesignationSync", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useSelectedTargetStore.getState().reset();
    designate();
  });
  afterEach(cleanup);

  it("keeps the designation when follow-me holds for the operator", () => {
    renderHook(() => useFollowDesignationSync(DRONE, "main"));
    push({ topic: "follow.lost", trackId: 15, reason: "search_exhausted", awaitingOperator: true, holdNe: [1, 2] }, 1000);
    expect(useSelectedTargetStore.getState().designated?.trackId).toBe(15);
  });

  it("clears it on a loss that does not wait, and on a stop", () => {
    renderHook(() => useFollowDesignationSync(DRONE, "main"));
    push({ topic: "follow.lost", trackId: 15, reason: "lock_lost", awaitingOperator: false, holdNe: null }, 1000);
    expect(useSelectedTargetStore.getState().designated).toBeNull();

    designate();
    push({ topic: "follow.stopped", reason: "revoked" }, 2000);
    expect(useSelectedTargetStore.getState().designated).toBeNull();
  });
});
