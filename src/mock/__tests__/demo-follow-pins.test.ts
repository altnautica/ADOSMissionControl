/**
 * @module demo-follow-pins.test
 * @description Demo mode reaches every follow-me recovery state through
 * `window.__adosDemoPilot.pin({ follow: {...} })`: the pin holds the demo
 * follow report in one phase (with agent fields laid over it), keeps it off
 * the pilot frame, and the waiting prompt's actions answer: search again
 * resumes the search, stop following ends the follow.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendFollowSetting } from "@/hooks/use-follow-setting";
import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { followPrompt } from "@/lib/hud/follow-prompt";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import { MockNavStream } from "@/mock/mock-nav";
import { mockPilot } from "@/mock/mock-pilot";
import type { GreyPngEncoder } from "@/mock/mock-occupancy";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSettingsStore } from "@/stores/settings-store";

const DRONE = "node:demo";
const stubEncoder: GreyPngEncoder = (grey, w, h) => `png:${w}x${h}:${grey.length}`;

const FOLLOWING = {
  armed: true,
  landed: false,
  owner: "skill",
  skill: { plugin_id: FOLLOW_ME_PLUGIN_ID, skill_id: "follow-me", label: "Follow-Me" },
};

const feed = () => useNavStreamStore.getState().byDrone[DRONE];
const follow = () => feed()?.follow?.data;

let stream: MockNavStream;

beforeEach(() => {
  vi.useFakeTimers();
  void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  stream = new MockNavStream(stubEncoder);
  stream.start(DRONE, Date.now());
});

afterEach(() => {
  stream.stop();
  void useSettingsStore.setState({ demoMode: false });
  vi.useRealTimers();
});

describe("demo follow pins", () => {
  it.each([
    ["predicting", { reacquireRemainingS: 6.5, vantageNe: null }],
    ["repositioning", { vantageState: "enroute", searchStep: null }],
    ["searching", { vantageState: "arrived", searchStep: 1, occluder: { kind: "narrow" } }],
    ["holding-await-operator", { holdReason: "search-exhausted", targetNed: null }],
  ] as const)("holds the follow report in %s through the console handle", (phase, fields) => {
    window.__adosDemoPilot!.pin({ ...FOLLOWING, follow: { phase } });
    vi.advanceTimersByTime(400);
    expect(follow()).toMatchObject({ phase, ...fields });
    // Pinned: the same phase a whole demo cycle later.
    vi.advanceTimersByTime(40_000);
    expect(follow()?.phase).toBe(phase);
    if (phase !== "holding-await-operator") {
      expect(follow()?.searchArea).not.toBeNull();
      expect(follow()?.predictedPathNe?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("lays agent fields over the pinned report and keeps them off the pilot frame", () => {
    window.__adosDemoPilot!.pin({
      ...FOLLOWING,
      follow: { phase: "holding-await-operator", hold_reason: "no-range", reacquire_mode: "strict" },
    });
    vi.advanceTimersByTime(400);
    const f = follow()!;
    expect(f).toMatchObject({ holdReason: "no-range", reacquireMode: "strict" });
    expect(followPrompt(f)?.actions).toEqual(["redesignate", "rth", "land", "stop"]);
    expect(Object.keys(feed()!.pilot!.data)).not.toContain("follow");
  });

  it("answers search again by searching, and stop following by ending the follow", async () => {
    window.__adosDemoPilot!.pin({ ...FOLLOWING, follow: { phase: "holding-await-operator", hold_reason: "search-exhausted" } });
    vi.advanceTimersByTime(400);
    const seq = follow()!.operatorResumeSeq;
    const device = "demo";
    await writePluginConfigValue({ droneId: device, pluginId: FOLLOW_ME_PLUGIN_ID, key: "operator_resume_seq", value: seq + 1 });
    vi.advanceTimersByTime(400);
    expect(follow()).toMatchObject({ phase: "searching", operatorResumeSeq: seq + 1, holdReason: null });

    await writePluginConfigValue({ droneId: device, pluginId: FOLLOW_ME_PLUGIN_ID, key: "active", value: false });
    vi.advanceTimersByTime(400);
    expect(follow()).toBeUndefined();
  });

  it("waits for the operator after a lost camera, through the console handle", () => {
    window.__adosDemoPilot!.pin({ ...FOLLOWING, follow: { phase: "holding-await-operator", hold_reason: "camera-lost" } });
    vi.advanceTimersByTime(400);
    const f = follow()!;
    expect(f).toMatchObject({ phase: "holding-await-operator", holdReason: "camera-lost" });
    expect(f.holdNe).not.toBeNull();
    expect(followPrompt(f)).toMatchObject({
      bodyKey: "follow.prompt.await_body.camera_lost",
      actions: ["redesignate", "rth", "land", "stop"],
    });
  });

  it("searches again from the scripted wait, with no pin, until the cycle moves on", async () => {
    window.__adosDemoPilot!.pin(FOLLOWING);
    vi.advanceTimersByTime(29_000);
    expect(follow()?.phase).toBe("holding-await-operator");
    await writePluginConfigValue({ droneId: "demo", pluginId: FOLLOW_ME_PLUGIN_ID, key: "operator_resume_seq", value: 1 });
    vi.advanceTimersByTime(400);
    expect(follow()).toMatchObject({ phase: "searching", operatorResumeSeq: 1, holdReason: null });
    // The next loop starts afresh.
    vi.advanceTimersByTime(4_000);
    expect(mockPilot.followPin()).toBeNull();
    expect(follow()?.phase).toBe("idle");
  });

  it("latches the hold point for the whole wait", () => {
    window.__adosDemoPilot!.pin(FOLLOWING);
    vi.advanceTimersByTime(28_400);
    const first = follow()!;
    expect(first.phase).toBe("holding-await-operator");
    vi.advanceTimersByTime(3_000);
    expect(follow()!.phase).toBe("holding-await-operator");
    expect(follow()!.holdNe).toEqual(first.holdNe);
  });

  it("echoes the cockpit's when-unsure and predictive search writes", async () => {
    window.__adosDemoPilot!.pin(FOLLOWING);
    vi.advanceTimersByTime(12_600);
    expect(follow()).toMatchObject({ uncertainMode: "follow", predictiveSearch: true });
    await sendFollowSetting(DRONE, "uncertain_mode", "hold");
    await sendFollowSetting(DRONE, "predictive_search", false);
    vi.advanceTimersByTime(400);
    expect(follow()).toMatchObject({ uncertainMode: "hold", predictiveSearch: false });
  });
});
