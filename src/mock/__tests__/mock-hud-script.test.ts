/**
 * @module mock-hud-script.test
 * @description The scripted demo HUD cycle: which state shows at a given
 * time, the detection batch and follow-me frame for it, and the one-shot
 * effects (designation, follow events) that fire when a state begins.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import {
  BACKGROUND_TRACK,
  HOLD_REASON_NO_RANGE,
  HUD_CYCLE_S,
  REACQUIRED_TRACK,
  TARGET_TRACK,
  entryEffect,
  extnavHealthAt,
  followPhaseAt,
  hudStateAt,
  scriptDetections,
  scriptFollow,
  type FollowContext,
} from "@/mock/mock-hud-script";

const CTX: FollowContext = {
  cameraId: "cam-a",
  vehicleYawDeg: 90,
  reacquireMode: "smart",
  droneNed: [1, 2],
};

function target(t: number) {
  return scriptDetections(t).find((d) => d.trackId === TARGET_TRACK);
}

describe("hudStateAt", () => {
  it("walks eight 4 s states and loops every 32 s", () => {
    const seq = [0, 4, 8, 12, 16, 20, 24, 28].map((t) => hudStateAt(t + 0.5).state);
    expect(seq).toEqual([
      "candidate",
      "tracked",
      "locked",
      "following",
      "coasting",
      "searching",
      "reacquired",
      "lost",
    ]);
    expect(HUD_CYCLE_S).toBe(32);
    const loop = hudStateAt(HUD_CYCLE_S + 1.25);
    expect(loop).toMatchObject({ state: "candidate", cycle: 1 });
    expect(loop.localS).toBeCloseTo(1.25);
  });
});

describe("scriptDetections", () => {
  it("shows an untracked candidate plus one sub-threshold box", () => {
    const dets = scriptDetections(1);
    const untracked = dets.filter((d) => d.trackId == null);
    expect(untracked.some((d) => d.confidence >= 0.45 && d.classLabel === "person")).toBe(true);
    expect(untracked.some((d) => d.confidence < 0.45)).toBe(true);
    expect(target(1)).toBeUndefined();
    expect(dets.some((d) => d.trackId === BACKGROUND_TRACK)).toBe(true);
  });

  it("tracks the subject as track 12 from the tracked state", () => {
    expect(target(5)).toMatchObject({ lockState: "locked" });
    expect(target(9)).toMatchObject({ lockState: "locked" });
  });

  it("dips to an uncertain association while following", () => {
    expect(target(13.5)).toMatchObject({ lockState: "uncertain", confidence: 0.61 });
    expect(target(12.5)).toMatchObject({ lockState: "locked" });
  });

  it("drops track 12 while coasting and searching, then shows track 15", () => {
    expect(target(17)).toBeUndefined();
    expect(target(21)).toBeUndefined();
    expect(scriptDetections(25).some((d) => d.trackId === REACQUIRED_TRACK)).toBe(true);
    expect(scriptDetections(29).some((d) => d.trackId === REACQUIRED_TRACK)).toBe(false);
  });

  it("keeps the background track in every state", () => {
    for (let t = 0; t < HUD_CYCLE_S; t += 2) {
      expect(scriptDetections(t).some((d) => d.trackId === BACKGROUND_TRACK)).toBe(true);
    }
  });
});

describe("followPhaseAt", () => {
  it.each([
    [1, "idle"],
    [5, "idle"],
    [9, "idle"],
    [11.5, "acquiring"],
    [12.5, "following"],
    [15.5, "holding"],
    [17, "coasting"],
    [21, "searching"],
    [25, "following"],
    [29, "lost"],
  ])("t=%s → %s", (t, phase) => {
    expect(followPhaseAt(t)).toBe(phase);
  });
});

describe("scriptFollow", () => {
  it("is inactive and empty while idle, but echoes the reacquire mode", () => {
    const f = scriptFollow(2, { ...CTX, reacquireMode: "strict" });
    expect(f).toMatchObject({ active: false, phase: "idle", trackId: null, rangeM: null, reacquireMode: "strict" });
  });

  it("fills range, cues, AGL and geometry while following", () => {
    const f = scriptFollow(12.5, CTX);
    expect(f.trackId).toBe(TARGET_TRACK);
    expect(f.rangeM).toBeGreaterThan(8);
    expect(f.rangeM).toBeLessThan(12);
    expect(f.rangeSigmaM).toBeGreaterThan(0);
    expect(f.rangeCues.map((c) => c.kind)).toEqual(["ground", "box_height", "lidar"]);
    expect(f.aglSource).toBe("rng");
    expect(f.reacquireMode).toBe("smart");
    expect(f.pipelineLatencyMs).toBeGreaterThan(0);
    expect(f.bearingDeg).not.toBeNull();
    expect(f.depressionDeg).not.toBeNull();
    expect(f.targetNed).not.toBeNull();
    expect(f.targetVelNed).not.toBeNull();
    expect(f.predictedBbox).toBeNull();
  });

  it("reports the uncertain confidence and a range-less hold", () => {
    expect(scriptFollow(13.5, CTX).confidence).toBe(0.61);
    const hold = scriptFollow(15.5, CTX);
    expect(hold).toMatchObject({ phase: "holding", holdReason: HOLD_REASON_NO_RANGE, rangeM: null, rangeCues: [] });
  });

  it("moves a predicted box on the active camera and counts the coast down", () => {
    const a = scriptFollow(16.5, CTX);
    const b = scriptFollow(18.5, CTX);
    expect(a.predictedBbox?.cameraId).toBe("cam-a");
    expect(a.predictedBbox).toMatchObject({ frameW: 640, frameH: 480 });
    expect(b.predictedBbox!.x).toBeGreaterThan(a.predictedBbox!.x);
    expect(a.coastRemainingS).toBeCloseTo(3.5);
    expect(b.coastRemainingS).toBeCloseTo(1.5);
  });

  it("searches on-frame first, then off-frame to the side on baro AGL", () => {
    const ring = scriptFollow(21, CTX);
    expect(ring.phase).toBe("searching");
    expect(ring.predictedBbox).not.toBeNull();
    const off = scriptFollow(23, CTX);
    expect(off.predictedBbox).toBeNull();
    expect(off.bearingDeg).toBeCloseTo(162);
    expect(off.aglSource).toBe("baro");
  });

  it("follows the re-acquired track and reports lost without range", () => {
    expect(scriptFollow(25, CTX)).toMatchObject({ phase: "following", trackId: REACQUIRED_TRACK });
    expect(scriptFollow(29, CTX)).toMatchObject({ phase: "lost", trackId: REACQUIRED_TRACK, rangeM: null, bearingDeg: null });
  });
});

describe("entryEffect", () => {
  it("releases at the loop start, designates 12 then 15, and pushes events", () => {
    expect(entryEffect("candidate")).toEqual({ release: true, designateTrack: null, event: null });
    expect(entryEffect("locked").designateTrack).toBe(TARGET_TRACK);
    expect(entryEffect("reacquired")).toEqual({
      release: false,
      designateTrack: REACQUIRED_TRACK,
      event: { topic: "follow.reacquired", trackId: 15, similarity: 0.86, gapS: 1.8 },
    });
    expect(entryEffect("lost").event).toMatchObject({ topic: "follow.lost", trackId: REACQUIRED_TRACK });
    expect(entryEffect("coasting")).toEqual({ release: false, designateTrack: null, event: null });
  });
});

describe("extnavHealthAt", () => {
  it("degrades only while searching", () => {
    expect(extnavHealthAt(13)).toBe("good");
    expect(extnavHealthAt(21)).toBe("degraded");
  });
});
