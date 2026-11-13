/**
 * @license GPL-3.0-only
 *
 * The map's point menu stays on screen: it is clamped to the viewport, not to
 * the map it opened on, so a small minimap card does not push items below the
 * fold.
 */

import { describe, expect, it } from "vitest";
import { menuViewportStyle } from "../menu-position";

const viewport = { width: 1280, height: 720 };
const menu = { width: 220, height: 16 * 32 + 40 };

function onScreen(s: ReturnType<typeof menuViewportStyle>, height: number) {
  expect(s.left).toBeGreaterThanOrEqual(0);
  expect(s.top).toBeGreaterThanOrEqual(0);
  expect(s.left + s.minWidth).toBeLessThanOrEqual(viewport.width);
  expect(s.top + Math.min(height, s.maxHeight)).toBeLessThanOrEqual(viewport.height);
}

describe("map point menu position", () => {
  it("keeps a tall menu from a small minimap inside the viewport", () => {
    // A 178 px minimap card in the lower right corner.
    const s = menuViewportStyle({ x: 90, y: 120 }, { left: 1090, top: 530 }, menu, viewport);
    onScreen(s, menu.height);
    expect(s.top).toBe(viewport.height - menu.height - 8);
  });

  it("opens at the pointer when it fits", () => {
    const s = menuViewportStyle({ x: 40, y: 30 }, { left: 100, top: 50 }, menu, viewport);
    expect(s).toMatchObject({ left: 140, top: 80 });
  });

  it("caps a menu taller than the viewport so it scrolls", () => {
    const small = { width: 400, height: 300 };
    const s = menuViewportStyle({ x: 10, y: 10 }, { left: 0, top: 0 }, menu, small);
    expect(s.top).toBe(8);
    expect(s.maxHeight).toBe(284);
  });
});
