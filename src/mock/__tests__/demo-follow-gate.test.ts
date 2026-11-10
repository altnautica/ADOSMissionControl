/**
 * @module demo-follow-gate.test
 * @description The demo follow-me feed reports only while the demo pilot
 * flies the Follow-Me skill (owner `skill`), as an agent does: a mission, a
 * failsafe return or the ground after disarm emit no `follow.state`, no
 * follow events and no follow designation.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { mockDetectionStream } from "@/mock/mock-detections";
import { MockNavStream } from "@/mock/mock-nav";
import { mockPilot } from "@/mock/mock-pilot";
import type { GreyPngEncoder } from "@/mock/mock-occupancy";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";

const DRONE = "node:demo";
const stubEncoder: GreyPngEncoder = (grey, w, h) => `png:${w}x${h}:${grey.length}`;

const FOLLOWING = {
  armed: true,
  landed: false,
  owner: "skill",
  skill: { plugin_id: FOLLOW_ME_PLUGIN_ID, skill_id: "follow-me", label: "Follow-Me" },
};
const MISSION = { armed: true, landed: false, owner: "mission_fc" };
const FAILSAFE_RTH = { armed: true, landed: false, owner: "fc_mode", fc_failsafe: true, failsafe_cause: "battery" };
const ANOTHER_SKILL = {
  armed: true,
  landed: false,
  owner: "skill",
  skill: { plugin_id: "com.example.survey", skill_id: "grid", label: "Grid" },
};

const feed = () => useNavStreamStore.getState().byDrone[DRONE];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  mockDetectionStream.stop();
  useSelectedTargetStore.getState().release();
  vi.useRealTimers();
});

describe("demo follow.state", () => {
  let stream: MockNavStream;
  beforeEach(() => {
    stream = new MockNavStream(stubEncoder);
  });
  afterEach(() => stream.stop());

  it.each([
    ["on the ground", {}],
    ["flying a mission", MISSION],
    ["in a failsafe return", FAILSAFE_RTH],
    ["running a skill that is not follow", ANOTHER_SKILL],
    ["with the follow skill pinned but disarmed", { ...FOLLOWING, armed: false, landed: true }],
  ])("emits nothing %s", (_label, pins) => {
    stream.start(DRONE, Date.now());
    mockPilot.pin(pins);
    vi.advanceTimersByTime(14_000);
    expect(feed()?.follow).toBeUndefined();
  });

  it("reports while the follow skill flies, and stops when it ends", () => {
    stream.start(DRONE, Date.now());
    mockPilot.pin(FOLLOWING);
    vi.advanceTimersByTime(14_000);
    expect(feed()?.follow?.data.phase).toBe("following");
    mockPilot.pin(MISSION);
    vi.advanceTimersByTime(1_000);
    expect(feed()?.follow).toBeUndefined();
  });
});

describe("demo follow events and designation", () => {
  it("raise no re-acquired event and designate nothing during a mission", () => {
    mockDetectionStream.start(DRONE);
    mockPilot.pin(MISSION);
    vi.advanceTimersByTime(27_000);
    expect(feed()?.followEvent).toBeUndefined();
    expect(useSelectedTargetStore.getState().designated).toBeNull();
  });

  it("raise the re-acquired event while the follow skill flies", () => {
    mockDetectionStream.start(DRONE);
    mockPilot.pin(FOLLOWING);
    vi.advanceTimersByTime(27_000);
    expect(feed()?.followEvent?.data.topic).toBe("follow.reacquired");
    expect(useSelectedTargetStore.getState().designated?.droneId).toBe(DRONE);
  });
});
