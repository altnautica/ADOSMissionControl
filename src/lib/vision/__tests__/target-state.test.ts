/**
 * HUD target resolver: the shared test vectors (frame 1280×720, rendered rect
 * 1280×720 at (0, 0), camera `main`).
 */

import { describe, expect, it } from "vitest";

import { parseFollowState } from "@/lib/agent/nav-types";
import type { VisionDetection } from "@/stores/vision-detections-store";

import {
  bracketArm,
  bracketPath,
  classWord,
  formatRange,
  holdReasonWord,
  offFrameArrow,
  rangeInterval,
  reacquiredToast,
  wrap180,
} from "../target-format";
import { followedRect, resolveTargets, type ResolveInput } from "../target-state";

const NOW = 1_000_000;

function det(over: Partial<VisionDetection> = {}): VisionDetection {
  return {
    bbox: { x: 600, y: 300, width: 80, height: 160 },
    classLabel: "person",
    confidence: 0.97,
    trackId: 12,
    lockState: "locked",
    ...over,
  } as VisionDetection;
}

function input(over: Partial<ResolveInput> = {}, detections: VisionDetection[] = []): ResolveInput {
  return {
    batch: { cameraId: "main", frameWidth: 1280, frameHeight: 720, detections },
    cameraId: "main",
    designated: null,
    follow: null,
    followAgeMs: 0,
    event: null,
    nowMs: NOW,
    ...over,
  };
}

const designated12 = { cameraId: "main", trackId: 12, bbox: { x: 600, y: 300, width: 80, height: 160 } };

function follow(raw: Record<string, unknown>) {
  const f = parseFollowState(raw);
  if (!f) throw new Error("bad follow fixture");
  return f;
}

const following = follow({ phase: "following", track_id: 12, range_m: 10.2, range_sigma_m: 0.3 });

describe("resolveTargets — test vectors", () => {
  it("T1 candidate", () => {
    const r = resolveTargets(input({}, [det({ trackId: null, confidence: 0.82, lockState: undefined })]));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].kind).toBe("CANDIDATE");
    expect(r.items[0].topTag?.text).toBe("PERSON 82%");
  });

  it("T2 low-confidence candidate is not drawn", () => {
    const r = resolveTargets(input({}, [det({ trackId: null, confidence: 0.3, lockState: undefined })]));
    expect(r.items).toHaveLength(0);
  });

  it("T3 tracked", () => {
    const r = resolveTargets(input({}, [det()]));
    expect(r.items[0].kind).toBe("TRACKED");
    expect(r.items[0].topTag?.text).toBe("PERSON #12");
  });

  it("T4 lost track is not drawn", () => {
    const r = resolveTargets(input({}, [det({ lockState: "lost" })]));
    expect(r.items).toHaveLength(0);
  });

  it("T5 designated with no follow → LOCKED, no reticle", () => {
    const r = resolveTargets(input({ designated: designated12 }, [det()]));
    expect(r.items[0].kind).toBe("LOCKED");
    expect(r.items[0].topTag?.text).toBe("LOCK #12 97%");
    expect(r.items[0].reticle).toBe(false);
  });

  it("T6 following", () => {
    const r = resolveTargets(input({ designated: designated12, follow: following, followAgeMs: 100 }, [det()]));
    const it0 = r.items[0];
    expect(it0.kind).toBe("FOLLOWING");
    expect(it0.topTag).toEqual({ text: "TRACK 97%", tone: "trackFilled" });
    expect(it0.bottomTags.map((t) => t.text)).toEqual(["10.2 m", "±0.6 m"]);
    expect(it0.reticle).toBe(true);
    expect(it0.feetTick).toBe(true);
  });

  it("T7 stale follow → LOCKED + followStale", () => {
    const r = resolveTargets(input({ designated: designated12, follow: following, followAgeMs: 2500 }, [det()]));
    expect(r.items[0].kind).toBe("LOCKED");
    expect(r.items[0].modifiers.followStale).toBe(true);
    expect(r.items[0].bottomTags.map((t) => t.text)).toEqual(["FOLLOW STALE"]);
  });

  it("T8 uncertain following", () => {
    const r = resolveTargets(
      input({ designated: designated12, follow: following, followAgeMs: 100 }, [
        det({ lockState: "uncertain", confidence: 0.61 }),
      ]),
    );
    expect(r.items[0].kind).toBe("FOLLOWING");
    expect(r.items[0].modifiers.uncertain).toBe(true);
    expect(r.items[0].topTag?.text).toBe("TRACK 61% ?");
  });

  it("T9 holding", () => {
    const f = follow({ phase: "holding", track_id: 12, hold_reason: "HOLD_NO_RANGE" });
    const r = resolveTargets(input({ designated: designated12, follow: f, followAgeMs: 100 }, [det()]));
    expect(r.items[0].kind).toBe("HOLDING");
    expect(r.items[0].topTag?.text).toBe("HOLD · NO RANGE");
    expect(r.items[0].reticle).toBe(true);
  });

  it("T10 coasting at the predicted box", () => {
    const f = follow({
      phase: "coasting",
      track_id: 12,
      coast_remaining_s: 1.43,
      predicted_bbox: { camera_id: "main", frame_w: 1280, frame_h: 720, x: 600, y: 300, w: 40, h: 98 },
    });
    const r = resolveTargets(input({ designated: designated12, follow: f, followAgeMs: 100 }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].kind).toBe("COASTING");
    expect(r.items[0].rect).toEqual({ x: 600, y: 300, w: 40, h: 98 });
    expect(r.items[0].topTag?.text).toBe("COAST 1.4 s");
  });

  it("T11 searching off-frame", () => {
    const f = follow({ phase: "searching", track_id: 12, predicted_bbox: null, bearing_deg: 64 });
    const r = resolveTargets(
      input({ follow: f, followAgeMs: 100, vehicleYawDeg: 10, cameraYawOffsetDeg: 0 }),
    );
    const it0 = r.items[0];
    expect(it0.kind).toBe("SEARCHING_OFFFRAME");
    expect(it0.relBearingDeg).toBeCloseTo(54);
    expect(it0.topTag?.text).toBe("SEARCHING · 064°");
    const a = offFrameArrow(it0.relBearingDeg!, { left: 0, top: 0, width: 1280, height: 720 });
    expect(a).toEqual({ x: 1113, y: 16, edge: "top" });
  });

  it("T11 belly camera never shows the off-frame arrow", () => {
    const f = follow({ phase: "searching", track_id: 12, predicted_bbox: null, bearing_deg: 64 });
    const r = resolveTargets(input({ follow: f, followAgeMs: 100, vehicleYawDeg: 10, cameraYawOffsetDeg: null }));
    expect(r.items).toHaveLength(0);
  });

  it("searching with an on-frame prediction draws the ring item", () => {
    const f = follow({
      phase: "searching",
      track_id: 12,
      predicted_bbox: { camera_id: "main", frame_w: 640, frame_h: 360, x: 100, y: 100, w: 20, h: 50 },
    });
    const r = resolveTargets(input({ follow: f, followAgeMs: 100 }));
    expect(r.items[0].kind).toBe("SEARCHING");
    // Scaled from the prediction's 640×360 frame to the batch's 1280×720.
    expect(r.items[0].rect).toEqual({ x: 200, y: 200, w: 40, h: 100 });
  });

  it("T12 re-acquired", () => {
    const r = resolveTargets(
      input(
        { event: { data: { topic: "follow.reacquired", trackId: 15, similarity: 0.862, gapS: 1.8 }, ageMs: 100 } },
        [det({ trackId: 15 })],
      ),
    );
    expect(r.items[0].trackId).toBe(15);
    expect(r.items[0].modifiers.reacquired).toBe(true);
    expect(reacquiredToast({ trackId: 15, similarity: 0.862, gapS: 1.8 })).toBe(
      "Re-acquired #15 · 0.86 · 1.8 s gap",
    );
    const later = resolveTargets(
      input(
        { event: { data: { topic: "follow.reacquired", trackId: 15, similarity: 0.862, gapS: 1.8 }, ageMs: 400 } },
        [det({ trackId: 15 })],
      ),
    );
    expect(later.items[0].modifiers.reacquired).toBe(false);
  });

  it("T13 lost fades at the last rect and is removed after 900 ms", () => {
    const f = follow({ phase: "lost", track_id: 12 });
    const last = { trackId: 12, rect: { x: 10, y: 20, w: 30, h: 40 }, frameW: 1280, frameH: 720, at: NOW - 300 };
    const r = resolveTargets(input({ designated: designated12, follow: f, followAgeMs: 100, lastFollowRect: last }));
    expect(r.items).toHaveLength(1);
    expect(r.items[0].kind).toBe("LOST");
    expect(r.items[0].rect).toEqual(last.rect);
    expect(r.items[0].topTag?.text).toBe("LOST");
    expect(r.items[0].lostProgress).toBeCloseTo(300 / 900);
    const gone = resolveTargets(
      input({ follow: f, followAgeMs: 100, lastFollowRect: { ...last, at: NOW - 1000 } }),
    );
    expect(gone.items).toHaveLength(0);
  });

  it("T13 a follow.lost event alone also shows LOST", () => {
    const last = { trackId: 12, rect: { x: 10, y: 20, w: 30, h: 40 }, frameW: 1280, frameH: 720, at: NOW - 100 };
    const r = resolveTargets(
      input({ event: { data: { topic: "follow.lost", trackId: 12, reason: "lock_lost" }, ageMs: 100 }, lastFollowRect: last }),
    );
    expect(r.items.map((i) => i.kind)).toEqual(["LOST"]);
  });

  it("T14 another camera's batch draws nothing", () => {
    const r = resolveTargets({
      ...input({}, [det()]),
      batch: { cameraId: "belly", frameWidth: 1280, frameHeight: 720, detections: [det()] },
    });
    expect(r.items).toHaveLength(0);
  });

  it("T15 video lost draws nothing", () => {
    const r = resolveTargets(
      input({ designated: designated12, follow: following, followAgeMs: 100, videoLost: true }, [det()]),
    );
    expect(r.items).toHaveLength(0);
  });

  it("T16 bracketArm", () => {
    expect(bracketArm(80, 120)).toBeCloseTo(17.6);
    expect(bracketArm(20, 30)).toBe(10);
    expect(bracketArm(300, 400)).toBe(28);
  });

  it("T17 rangeInterval", () => {
    expect(rangeInterval(10.2, 0.3)).toBe("9.6 – 10.8 m");
  });

  it("T18 formatRange", () => {
    expect(formatRange(9.96)).toBe("10.0 m");
    expect(formatRange(123.4)).toBe("123 m");
  });
});

describe("resolveTargets — limits and helpers", () => {
  it("caps candidate tags at 8 and items at 32, highest priority first", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      det({ trackId: null, confidence: 0.5 + i / 100, lockState: undefined, bbox: { x: i, y: 0, width: 10, height: 10 } }),
    );
    const r = resolveTargets(input({ designated: designated12 }, [det(), ...many]));
    expect(r.items).toHaveLength(32);
    expect(r.items[0].kind).toBe("LOCKED");
    expect(r.items.filter((i) => i.kind === "CANDIDATE" && i.topTag).length).toBe(8);
  });

  it("hides candidate tags in the PiP", () => {
    const r = resolveTargets(
      input({ opts: { pip: true } }, [det({ trackId: null, confidence: 0.82, lockState: undefined })]),
    );
    expect(r.items[0].topTag).toBeNull();
  });

  it("acquiring and GT modes", () => {
    const f = follow({ phase: "acquiring", track_id: 12, range_m: 8 });
    const a = resolveTargets(input({ designated: designated12, follow: f, followAgeMs: 0 }, [det()]));
    expect(a.items[0].kind).toBe("ACQUIRING");
    expect(a.items[0].topTag?.text).toBe("ACQUIRING #12");
    const gt = resolveTargets(input({ opts: { gt: true } }, [det({ trackId: 7, classLabel: "human" })]));
    expect(gt.items[0].topTag?.text).toBe("GT HUMAN #7");
  });

  it("followedRect returns the followed item", () => {
    const r = resolveTargets(input({ designated: designated12, follow: following, followAgeMs: 0 }, [det()]));
    expect(followedRect(r)).toEqual({ trackId: 12, rect: { x: 600, y: 300, w: 80, h: 160 } });
  });

  it("formatting helpers", () => {
    expect(classWord("fire-truck/large!")).toBe("FIRE TRUCK L");
    expect(holdReasonWord("HOLD_POSE_STALE")).toBe("POSE STALE");
    expect(holdReasonWord(null)).toBeNull();
    expect(wrap180(270)).toBe(-90);
    expect(bracketPath(0, 0, 100, 50, 10)).toBe(
      "M 0,10 V 0 H 10 M 90,0 H 100 V 10 M 100,40 V 50 H 90 M 10,50 H 0 V 40",
    );
    expect(offFrameArrow(180, { left: 0, top: 0, width: 200, height: 100 })).toEqual({ x: 100, y: 84, edge: "bottom" });
    expect(offFrameArrow(-90, { left: 0, top: 0, width: 200, height: 100 }).edge).toBe("left");
  });
});
