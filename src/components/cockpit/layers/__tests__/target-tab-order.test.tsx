/**
 * @license GPL-3.0-only
 *
 * The target click areas stay out of the Tab sequence: Tab walks the
 * flight-screen chrome, and never lands on a box drawn over the video.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { TargetHits, padHit, type HitLayout } from "../TargetHits";
import { padHit as padHitFromController } from "../TargetController";

function hit(key: string, x: number): HitLayout {
  return {
    key,
    kind: "detection",
    item: { detection: { classLabel: "person" } },
    hit: { x, y: 10, w: 20, h: 20 },
  } as unknown as HitLayout;
}

/** The focusable elements in Tab order (DOM order, tabindex >= 0). */
function tabSequence(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]")).filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute("disabled"),
  );
}

afterEach(cleanup);

describe("target click areas and the Tab order", () => {
  it("leaves every target out of the Tab sequence after the chrome", () => {
    const { container } = render(
      <div>
        <button type="button" data-testid="chrome-menu">Menu</button>
        <div className="stack">
          <TargetHits hits={[hit("a", 10), hit("b", 80)]} onHitClick={() => {}} onHover={() => {}} />
        </div>
        <button type="button" data-testid="chrome-stop">STOP</button>
      </div>,
    );
    const targets = container.querySelectorAll(".tgt-hit");
    expect(targets).toHaveLength(2);
    const seq = tabSequence(container).map((el) => el.dataset.testid ?? el.className);
    expect(seq).toEqual(["chrome-menu", "chrome-stop"]);
  });

  it("pads each hit area to the spec minimum, as the controller exports it", () => {
    expect(padHit({ x: 10, y: 10, w: 20, h: 20 })).toEqual({ x: -4, y: -4, w: 48, h: 48 });
    expect(padHitFromController).toBe(padHit);
  });
});
