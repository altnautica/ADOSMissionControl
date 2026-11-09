import { describe, expect, it } from "vitest";

import { parseFollowState } from "@/lib/hud/nav-types";
import {
  coverRect,
  inflateHit,
  pushGhostSample,
  reticlePath,
  searchRing,
  type GhostSample,
} from "@/lib/vision/target-geometry";
import {
  arrowTagPos,
  layoutTargets,
  placeBottomTags,
  placeTopTag,
  tagFontPx,
  tagSize,
} from "@/lib/vision/target-layout";
import {
  cycleFocus,
  dragAccepted,
  dragFrameBox,
  dragStarted,
  focusOrder,
} from "@/lib/vision/target-interaction";
import { resolveTargets, type ResolveInput } from "@/lib/vision/target-state";
import type { VisionDetection } from "@/stores/vision-detections-store";

const RR = { left: 0, top: 0, width: 1280, height: 720 };

function det(over: Partial<VisionDetection>): VisionDetection {
  return {
    bbox: { x: 100, y: 100, width: 80, height: 160 },
    classLabel: "person",
    confidence: 0.82,
    ...over,
  };
}

function resolve(detections: VisionDetection[], over: Partial<ResolveInput> = {}) {
  return resolveTargets({
    batch: { cameraId: "main", frameWidth: 1280, frameHeight: 720, detections },
    cameraId: "main",
    designated: null,
    follow: null,
    followAgeMs: 0,
    event: null,
    nowMs: 1000,
    ...over,
  });
}

describe("tag placement", () => {
  it("puts the top tag above-left, its bottom 3 px over the box", () => {
    const size = tagSize("PERSON #12", 11);
    expect(size.h).toBe(17);
    const p = placeTopTag({ x: 100, y: 100, w: 80, h: 160 }, size, RR);
    expect(p).toEqual({ x: 100, y: 100 - 3 - 17 });
  });

  it("moves the top tag inside the box when above would leave the video", () => {
    const p = placeTopTag({ x: 100, y: 5, w: 80, h: 160 }, { w: 60, h: 17 }, RR);
    expect(p.y).toBe(8);
  });

  it("clamps the top tag horizontally into the video", () => {
    const p = placeTopTag({ x: 1260, y: 100, w: 20, h: 40 }, { w: 90, h: 17 }, RR);
    expect(p.x).toBe(1280 - 90);
  });

  it("centres bottom tags under the box, 4 px apart, 3 px below", () => {
    const at = placeBottomTags({ x: 100, y: 100, w: 200, h: 100 }, [{ w: 50, h: 17 }, { w: 30, h: 17 }], RR);
    // total 84 → starts at 200 − 42.
    expect(at).toEqual([
      { x: 158, y: 203 },
      { x: 212, y: 203 },
    ]);
  });

  it("moves bottom tags inside the box bottom at the video's lower edge", () => {
    const at = placeBottomTags({ x: 100, y: 600, w: 200, h: 115 }, [{ w: 50, h: 17 }], RR);
    expect(at[0].y).toBe(715 - 3 - 17);
  });

  it("hides the lower-priority top tag when two overlap", () => {
    const resolved = resolve(
      [
        det({ trackId: 12, lockState: "locked", confidence: 0.9 }),
        det({ trackId: 13, lockState: "locked", confidence: 0.7, bbox: { x: 110, y: 100, width: 80, height: 160 } }),
      ],
      { designated: { cameraId: "main", trackId: 13, bbox: { x: 110, y: 100, width: 80, height: 160 } } },
    );
    const l = layoutTargets(resolved, { rendered: RR, fontPx: 11, widthClass: "expanded" });
    const locked = l.find((x) => x.kind === "LOCKED")!;
    const tracked = l.find((x) => x.kind === "TRACKED")!;
    expect(locked.topTag?.text).toBe("LOCK #13 70%");
    expect(tracked.topTag).toBeNull();
  });

  it("hides a short candidate's tag unless revealed", () => {
    const resolved = resolve([det({ bbox: { x: 100, y: 100, width: 30, height: 20 } })]);
    const hidden = layoutTargets(resolved, { rendered: RR, fontPx: 11, widthClass: "expanded" });
    expect(hidden[0].topTag).toBeNull();
    const shown = layoutTargets(resolved, {
      rendered: RR,
      fontPx: 11,
      widthClass: "expanded",
      revealKeys: new Set([hidden[0].key]),
    });
    expect(shown[0].topTag?.text).toBe("PERSON 82%");
  });

  it("compact width hides candidate tags and shortens tracked tags", () => {
    const resolved = resolve([det({}), det({ trackId: 12, lockState: "locked", bbox: { x: 600, y: 100, width: 80, height: 160 } })]);
    const l = layoutTargets(resolved, { rendered: RR, fontPx: 11, widthClass: "compact" });
    expect(l.find((x) => x.kind === "CANDIDATE")!.topTag).toBeNull();
    expect(l.find((x) => x.kind === "TRACKED")!.topTag?.text).toBe("#12");
  });
});

describe("marks", () => {
  it("skips the reticle on a box smaller than 2·(gap + arm)", () => {
    expect(reticlePath({ x: 0, y: 0, w: 47, h: 100 })).toBeNull();
    expect(reticlePath({ x: 0, y: 0, w: 48, h: 48 })).toBe(
      "M 24,18 V 0 M 30,24 H 48 M 24,30 V 48 M 18,24 H 0",
    );
  });

  it("sizes the search ring max(24, 0.6·h) at the feet point", () => {
    expect(searchRing({ x: 600, y: 300, w: 40, h: 98 })).toEqual({ cx: 620, cy: 398, r: 58.8 });
    expect(searchRing({ x: 0, y: 0, w: 10, h: 20 }).r).toBe(24);
  });

  it("inflates a small hit area to 44 px about the centre", () => {
    expect(inflateHit({ x: 100, y: 100, w: 20, h: 60 })).toEqual({ x: 88, y: 100, w: 44, h: 60 });
  });

  it("places the off-frame arrow on the inset rect and its tag inward (T11)", () => {
    const follow = parseFollowState({ phase: "searching", track_id: 12, bearing_deg: 64, predicted_bbox: null })!;
    const resolved = resolveTargets({
      batch: { cameraId: "main", frameWidth: 1280, frameHeight: 720, detections: [] },
      cameraId: "main",
      designated: null,
      follow,
      followAgeMs: 100,
      event: null,
      nowMs: 1000,
      vehicleYawDeg: 10,
      cameraYawOffsetDeg: 0,
    });
    const [arrow] = layoutTargets(resolved, { rendered: RR, fontPx: 11, widthClass: "expanded" });
    expect(arrow.kind).toBe("SEARCHING_OFFFRAME");
    expect(arrow.arrow).toMatchObject({ x: 1113, y: 16 });
    expect(arrow.topTag?.text).toBe("SEARCHING · 064°");
    // The tag sits inward (below the top-edge arrow).
    expect(arrow.topTag!.y).toBeGreaterThan(16);
    const pos = arrowTagPos(1113, 16, 54, { w: 100, h: 17 }, RR);
    expect(pos.y).toBeGreaterThan(16);
  });

  it("keeps the last 1 s of ghost samples, at most 30", () => {
    let s: GhostSample[] = [];
    for (let t = 0; t <= 2000; t += 20) s = pushGhostSample(s, { t, x: t, y: 0 });
    expect(s.length).toBe(30);
    expect(s[s.length - 1].t).toBe(2000);
    expect(s[0].t).toBeGreaterThanOrEqual(1000);
  });

  it("adds the predicted feet point to the coasting ghost path", () => {
    const follow = parseFollowState({
      phase: "coasting",
      track_id: 12,
      coast_remaining_s: 1.43,
      predicted_bbox: { camera_id: "main", frame_w: 1280, frame_h: 720, x: 600, y: 300, w: 40, h: 98 },
    })!;
    const resolved = resolve([], { follow, followAgeMs: 100 });
    const [coast] = layoutTargets(resolved, {
      rendered: RR,
      fontPx: 11,
      widthClass: "expanded",
      ghost: [
        { t: 0, x: 500, y: 400 },
        { t: 100, x: 550, y: 400 },
      ],
    });
    expect(coast.kind).toBe("COASTING");
    expect(coast.ghost).toEqual([
      { x: 500, y: 400 },
      { x: 550, y: 400 },
      { x: 620, y: 398 },
    ]);
  });
});

describe("geometry helpers", () => {
  it("chooses the tag size", () => {
    expect(tagFontPx("tv", false)).toBe(13);
    expect(tagFontPx("tv", true)).toBe(9);
    expect(tagFontPx("expanded", false)).toBe(11);
  });

  it("crops for object-cover", () => {
    expect(coverRect(160, 160, 320, 180)).toEqual({ left: (160 - 284.44444444444446) / 2, top: 0, width: 284.44444444444446, height: 160 });
  });
});

describe("interaction helpers", () => {
  it("starts a drag at 12 px and maps it into frame px", () => {
    expect(dragStarted({ x: 0, y: 0 }, { x: 8, y: 8 })).toBe(false);
    expect(dragStarted({ x: 0, y: 0 }, { x: 9, y: 9 })).toBe(true);
    const rr = { left: 0, top: 60, width: 640, height: 360 };
    const box = dragFrameBox({ x: 64, y: 96, w: 128, h: 72 }, rr, 1280, 720);
    expect(box).toEqual({ x: 128, y: 72, width: 256, height: 144 });
  });

  it("ignores a rect under 1 % of the frame", () => {
    expect(dragAccepted({ x: 0, y: 0, width: 12, height: 100 }, 1280, 720)).toBe(false);
    expect(dragAccepted({ x: 0, y: 0, width: 13, height: 8 }, 1280, 720)).toBe(true);
  });

  it("orders focus left to right and cycles", () => {
    const resolved = resolve([
      det({ trackId: 2, lockState: "locked", bbox: { x: 600, y: 100, width: 80, height: 160 } }),
      det({ trackId: 1, lockState: "locked", bbox: { x: 100, y: 100, width: 80, height: 160 } }),
    ]);
    const order = focusOrder(layoutTargets(resolved, { rendered: RR, fontPx: 11, widthClass: "expanded" }));
    expect(order).toEqual(["t:1", "t:2"]);
    expect(cycleFocus(order, null, 1)).toBe("t:1");
    expect(cycleFocus(order, "t:2", 1)).toBe("t:1");
    expect(cycleFocus(order, null, -1)).toBe("t:2");
    expect(cycleFocus([], null, 1)).toBeNull();
  });
});
