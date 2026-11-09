import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TargetGlyph } from "@/components/vision/TargetGlyph";
import { parseFollowState, type FollowEvent } from "@/lib/hud/nav-types";
import { layoutTargets } from "@/lib/vision/target-layout";
import { resolveTargets, type ResolveInput } from "@/lib/vision/target-state";
import type { VisionDetection } from "@/stores/vision-detections-store";

const RR = { left: 0, top: 0, width: 1280, height: 720 };
const BOX = { x: 600, y: 200, width: 80, height: 200 };

function det(over: Partial<VisionDetection> = {}): VisionDetection {
  return { bbox: BOX, classLabel: "person", confidence: 0.97, ...over };
}

function follow(raw: Record<string, unknown>) {
  const f = parseFollowState(raw);
  if (!f) throw new Error("bad follow fixture");
  return f;
}

function draw(input: Partial<ResolveInput>, opts: { pip?: boolean; reducedMotion?: boolean } = {}) {
  const resolved = resolveTargets({
    batch: { cameraId: "main", frameWidth: 1280, frameHeight: 720, detections: [] },
    cameraId: "main",
    designated: null,
    follow: null,
    followAgeMs: 0,
    event: null,
    nowMs: 10_000,
    ...input,
    opts: { pip: opts.pip },
  });
  const layouts = layoutTargets(resolved, {
    rendered: RR,
    fontPx: opts.pip ? 9 : 11,
    widthClass: "expanded",
  });
  const { container } = render(
    <div className="tgt-layer">
      {layouts.map((l) => (
        <TargetGlyph key={l.key} layout={l} reducedMotion={opts.reducedMotion ?? false} />
      ))}
    </div>,
  );
  return container;
}

function batchOf(...detections: VisionDetection[]): ResolveInput["batch"] {
  return { cameraId: "main", frameWidth: 1280, frameHeight: 720, detections };
}

const DESIGNATED_12 = { cameraId: "main", trackId: 12, bbox: BOX };

function tags(el: Element): string[] {
  return [...el.querySelectorAll(".tgt-tag")].map((t) => t.textContent ?? "");
}

describe("TargetGlyph states", () => {
  afterEach(cleanup);

  it("CANDIDATE: hairline rect, ink tag", () => {
    const c = draw({ batch: batchOf(det({ confidence: 0.82 })) });
    const g = c.querySelector('[data-kind="CANDIDATE"]')!;
    expect(g.querySelector(".tgt-hairline rect.tgt-o")).not.toBeNull();
    expect(g.querySelector(".tgt-brackets")).toBeNull();
    expect(tags(g)).toEqual(["PERSON 82%"]);
    expect(g.querySelector(".tgt-tag")!.getAttribute("data-tone")).toBe("ink");
  });

  it("TRACKED: outlined corner brackets, primary tag", () => {
    const c = draw({ batch: batchOf(det({ trackId: 12, lockState: "locked" })) });
    const g = c.querySelector('[data-kind="TRACKED"]')!;
    expect(g.querySelectorAll(".tgt-brackets path")).toHaveLength(2);
    expect(g.querySelector(".tgt-brackets .tgt-o")!.getAttribute("d")).toContain("M 600,");
    expect(tags(g)).toEqual(["PERSON #12"]);
    expect(g.querySelector(".tgt-tag")!.getAttribute("data-tone")).toBe("primary");
  });

  it("LOCKED: track brackets and lock tag, no reticle", () => {
    const c = draw({ batch: batchOf(det({ trackId: 12, lockState: "locked" })), designated: DESIGNATED_12 });
    const g = c.querySelector('[data-kind="LOCKED"]')!;
    expect(g.querySelector(".tgt-brackets")).not.toBeNull();
    expect(g.querySelector(".tgt-reticle")).toBeNull();
    expect(tags(g)).toEqual(["LOCK #12 97%"]);
  });

  it("FOLLOWING: filled TRACK tag, range tags, reticle and feet tick", () => {
    const c = draw({
      batch: batchOf(det({ trackId: 12, lockState: "locked" })),
      designated: DESIGNATED_12,
      follow: follow({ phase: "following", track_id: 12, range_m: 10.2, range_sigma_m: 0.3 }),
      followAgeMs: 100,
    });
    const g = c.querySelector('[data-kind="FOLLOWING"]')!;
    expect(tags(g)).toEqual(["TRACK 97%", "10.2 m", "±0.6 m"]);
    expect(g.querySelector('.tgt-tag[data-part="top"]')!.getAttribute("data-tone")).toBe("trackFilled");
    expect(g.querySelector(".tgt-reticle .tgt-s")).not.toBeNull();
    expect(g.querySelector(".tgt-feet .tgt-s")!.getAttribute("d")).toBe("M 635,400 H 645");
  });

  it("HOLDING: warn plate with the hold reason and a reticle", () => {
    const c = draw({
      batch: batchOf(det({ trackId: 12, lockState: "locked" })),
      designated: DESIGNATED_12,
      follow: follow({ phase: "holding", track_id: 12, hold_reason: "HOLD_NO_RANGE" }),
      followAgeMs: 100,
    });
    const g = c.querySelector('[data-kind="HOLDING"]')!;
    expect(tags(g)).toEqual(["HOLD · NO RANGE"]);
    expect(g.querySelector(".tgt-tag")!.getAttribute("data-tone")).toBe("warnFilled");
    expect(g.querySelector(".tgt-reticle")).not.toBeNull();
  });

  it("COASTING: brackets at the predicted box with the coast tag", () => {
    const c = draw({
      follow: follow({
        phase: "coasting",
        track_id: 12,
        coast_remaining_s: 1.43,
        predicted_bbox: { camera_id: "main", frame_w: 1280, frame_h: 720, x: 600, y: 300, w: 40, h: 98 },
      }),
      followAgeMs: 100,
    });
    const g = c.querySelector('[data-kind="COASTING"]')!;
    expect(g.getAttribute("data-box")).toBe("600.00,300.00,40.00,98.00");
    expect(g.querySelector(".tgt-brackets")).not.toBeNull();
    expect(tags(g)).toEqual(["COAST 1.4 s"]);
  });

  it("SEARCHING: ring with a sweep; static dashed ring under reduced motion", () => {
    const input = {
      follow: follow({
        phase: "searching",
        track_id: 12,
        predicted_bbox: { camera_id: "main", frame_w: 1280, frame_h: 720, x: 600, y: 300, w: 40, h: 98 },
      }),
      followAgeMs: 100,
    };
    const c = draw(input);
    const g = c.querySelector('[data-kind="SEARCHING"]')!;
    const ring = g.querySelector(".tgt-ring circle.tgt-s")!;
    expect(ring.getAttribute("cx")).toBe("620");
    expect(ring.getAttribute("r")).toBe("58.8");
    expect(g.querySelector(".tgt-sweep")).not.toBeNull();
    expect(tags(g)).toEqual(["SEARCHING"]);
    cleanup();

    const still = draw(input, { reducedMotion: true });
    expect(still.querySelector(".tgt-sweep")).toBeNull();
    expect(still.querySelector(".tgt-ring")!.hasAttribute("data-static")).toBe(true);
  });

  it("SEARCHING_OFFFRAME: edge arrow with the bearing tag", () => {
    const c = draw({
      follow: follow({ phase: "searching", track_id: 12, bearing_deg: 64, predicted_bbox: null }),
      followAgeMs: 100,
      vehicleYawDeg: 10,
      cameraYawOffsetDeg: 0,
    });
    const g = c.querySelector('[data-kind="SEARCHING_OFFFRAME"]')!;
    expect(g.querySelector(".tgt-arrow")).not.toBeNull();
    expect(tags(g)).toEqual(["SEARCHING · 064°"]);
  });

  it("SEARCHING_OFFFRAME is never drawn for a down-facing camera", () => {
    const c = draw({
      follow: follow({ phase: "searching", track_id: 12, bearing_deg: 64, predicted_bbox: null }),
      followAgeMs: 100,
      vehicleYawDeg: 10,
      cameraYawOffsetDeg: null,
    });
    expect(c.querySelector('[data-kind="SEARCHING_OFFFRAME"]')).toBeNull();
  });

  it("LOST: crit brackets at the last rect, fading by elapsed share", () => {
    const event: FollowEvent = { topic: "follow.lost", trackId: 12, reason: "lock_lost" };
    const c = draw({
      event: { data: event, ageMs: 100 },
      lastFollowRect: { trackId: 12, rect: { x: 600, y: 200, w: 80, h: 200 }, frameW: 1280, frameH: 720, at: 10_000 - 450 },
    });
    const g = c.querySelector('[data-kind="LOST"]') as HTMLElement;
    expect(tags(g)).toEqual(["LOST"]);
    expect(g.style.animationDelay).toBe("-450ms");
  });

  it("re-acquired: the new track's brackets snap", () => {
    const event: FollowEvent = { topic: "follow.reacquired", trackId: 15, similarity: 0.862, gapS: 1.8 };
    const c = draw({
      batch: batchOf(det({ trackId: 15, lockState: "locked" })),
      event: { data: event, ageMs: 100 },
    });
    const g = c.querySelector('[data-kind="TRACKED"]')!;
    expect(g.hasAttribute("data-reacquired")).toBe(true);
    expect(g.querySelector(".tgt-brackets.tgt-snap")).not.toBeNull();
  });

  it("uncertain: modifier on the glyph and a ? tag", () => {
    const c = draw({
      batch: batchOf(det({ trackId: 12, lockState: "uncertain", confidence: 0.61 })),
      designated: DESIGNATED_12,
      follow: follow({ phase: "following", track_id: 12 }),
      followAgeMs: 100,
    });
    const g = c.querySelector('[data-kind="FOLLOWING"]')!;
    expect(g.hasAttribute("data-uncertain")).toBe(true);
    expect(tags(g)[0]).toBe("TRACK 61% ?");
  });

  it("follow stale: LOCKED look with a FOLLOW STALE tag", () => {
    const c = draw({
      batch: batchOf(det({ trackId: 12, lockState: "locked" })),
      designated: DESIGNATED_12,
      follow: follow({ phase: "following", track_id: 12 }),
      followAgeMs: 2500,
    });
    const g = c.querySelector('[data-kind="LOCKED"]')!;
    expect(g.hasAttribute("data-follow-stale")).toBe(true);
    expect(tags(g)).toEqual(["LOCK #12 97%", "FOLLOW STALE"]);
  });

  it("PiP: candidate tags hidden, 9 px type", () => {
    const c = draw(
      { batch: batchOf(det({ confidence: 0.82 }), det({ trackId: 3, lockState: "locked", bbox: { x: 100, y: 100, width: 80, height: 160 } })) },
      { pip: true },
    );
    expect(tags(c.querySelector('[data-kind="CANDIDATE"]')!)).toEqual([]);
    const tracked = c.querySelector('[data-kind="TRACKED"]') as HTMLElement;
    expect(tracked.style.getPropertyValue("--tgt-font")).toBe("9px");
  });

  it("video lost: nothing drawn", () => {
    const c = draw({ batch: batchOf(det({ trackId: 12, lockState: "locked" })), videoLost: true });
    expect(c.querySelector(".tgt")).toBeNull();
  });
});
