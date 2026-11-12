/**
 * Revealing a tab moves only its strip's horizontal scroll.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { revealInStrip } from "@/components/dashboard/node-detail/reveal-in-strip";

function box(el: HTMLElement, left: number, right: number) {
  el.getBoundingClientRect = () => ({ left, right }) as DOMRect;
}

describe("revealInStrip", () => {
  it("scrolls right by the overflow of a tab past the right edge", () => {
    const strip = document.createElement("div");
    const tab = document.createElement("button");
    box(strip, 0, 400);
    box(tab, 380, 460);
    revealInStrip(strip, tab);
    expect(strip.scrollLeft).toBe(60);
  });

  it("leaves a visible tab alone", () => {
    const strip = document.createElement("div");
    const tab = document.createElement("button");
    box(strip, 0, 400);
    box(tab, 100, 180);
    revealInStrip(strip, tab);
    expect(strip.scrollLeft).toBe(0);
  });
});
