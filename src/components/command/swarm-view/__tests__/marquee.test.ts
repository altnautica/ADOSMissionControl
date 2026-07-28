/**
 * @module command/swarm-view/marquee.test
 * @description The two drag conventions the fleet map selects by.
 *
 * Getting these backwards is how an operator lassos six drones and commands
 * eight. The rule is the one every operator already has in their fingers from
 * CAD, GIS and RTS: NW→SE is a window and takes only what it fully encloses;
 * any reversed drag is a crossing and takes anything it touches.
 *
 * Containment is tested against the icon's square, not its anchor point,
 * because a half-covered arrow is visibly not "enclosed" and an operator who
 * sees it selected stops trusting the gesture.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import {
  MARQUEE_MIN_DRAG_PX,
  isEnclosingDrag,
  isMarqueeDrag,
  marqueeBounds,
  marqueeSelection,
  type MarqueePoint,
} from "../marquee";

const ICON = 20;

/** Slot 1 sits fully inside a 0,0→100,100 band; slot 2 straddles its edge. */
const POINTS: MarqueePoint[] = [
  { slot: 1, x: 50, y: 50 },
  { slot: 2, x: 98, y: 50 },
  { slot: 3, x: 200, y: 200 },
];

describe("isEnclosingDrag", () => {
  it("treats only a down-right drag as the window gesture", () => {
    expect(isEnclosingDrag({ x1: 0, y1: 0, x2: 100, y2: 100 })).toBe(true);
  });

  it("treats a reversal on either axis as a crossing gesture", () => {
    expect(isEnclosingDrag({ x1: 100, y1: 0, x2: 0, y2: 100 })).toBe(false);
    expect(isEnclosingDrag({ x1: 0, y1: 100, x2: 100, y2: 0 })).toBe(false);
    expect(isEnclosingDrag({ x1: 100, y1: 100, x2: 0, y2: 0 })).toBe(false);
  });
});

describe("marqueeSelection", () => {
  it("forward drag takes only the fully contained icon", () => {
    // Slot 2's icon spans x 88..108 and the band ends at 100, so it is
    // half outside and must not be selected.
    expect(
      marqueeSelection({ x1: 0, y1: 0, x2: 100, y2: 100 }, POINTS, ICON),
    ).toEqual([1]);
  });

  it("reverse drag takes everything the band touches", () => {
    // Same rectangle, dragged SE→NW: the straddling icon now counts.
    expect(
      marqueeSelection({ x1: 100, y1: 100, x2: 0, y2: 0 }, POINTS, ICON),
    ).toEqual([1, 2]);
  });

  it("a single reversed axis is enough to switch to crossing", () => {
    expect(
      marqueeSelection({ x1: 0, y1: 100, x2: 100, y2: 0 }, POINTS, ICON),
    ).toEqual([1, 2]);
  });

  it("selects an icon exactly flush with the forward band's edges", () => {
    // Anchor 50,50 with a 20px icon spans 40..60 — flush is inside, by design:
    // an operator who drags precisely to the glyph's edge means to take it.
    expect(
      marqueeSelection({ x1: 40, y1: 40, x2: 60, y2: 60 }, POINTS, ICON),
    ).toEqual([1]);
  });

  it("rejects an icon one pixel short of enclosure", () => {
    expect(
      marqueeSelection({ x1: 41, y1: 40, x2: 60, y2: 60 }, POINTS, ICON),
    ).toEqual([]);
  });

  it("takes an icon a crossing band merely grazes", () => {
    // Band 60..70; slot 1's icon ends exactly at 60. Reverse drag, so touch wins.
    expect(
      marqueeSelection({ x1: 70, y1: 70, x2: 60, y2: 40 }, POINTS, ICON),
    ).toEqual([1]);
  });

  it("returns nothing when the band is nowhere near the fleet", () => {
    expect(
      marqueeSelection({ x1: 400, y1: 400, x2: 500, y2: 500 }, POINTS, ICON),
    ).toEqual([]);
  });

  it("preserves the order the points were given in", () => {
    expect(
      marqueeSelection({ x1: 300, y1: 300, x2: 0, y2: 0 }, POINTS, ICON),
    ).toEqual([1, 2, 3]);
  });
});

describe("marqueeBounds", () => {
  it("normalises a reversed drag to the same rectangle", () => {
    expect(marqueeBounds({ x1: 90, y1: 80, x2: 10, y2: 20 })).toEqual({
      left: 10,
      top: 20,
      right: 90,
      bottom: 80,
    });
  });
});

describe("isMarqueeDrag", () => {
  it("treats a tap as a click, not a zero-area crossing selection", () => {
    // Without this a tap would be a degenerate crossing band and, under the
    // touch rule, would sweep in whatever icon happened to be under the finger.
    expect(isMarqueeDrag({ x1: 50, y1: 50, x2: 50, y2: 50 })).toBe(false);
    expect(
      isMarqueeDrag({
        x1: 50,
        y1: 50,
        x2: 50 + MARQUEE_MIN_DRAG_PX - 1,
        y2: 50 + MARQUEE_MIN_DRAG_PX - 1,
      }),
    ).toBe(false);
  });

  it("counts a drag that clears the threshold on either axis alone", () => {
    expect(
      isMarqueeDrag({ x1: 50, y1: 50, x2: 50, y2: 50 + MARQUEE_MIN_DRAG_PX }),
    ).toBe(true);
    expect(
      isMarqueeDrag({ x1: 50, y1: 50, x2: 50 - MARQUEE_MIN_DRAG_PX, y2: 50 }),
    ).toBe(true);
  });
});
