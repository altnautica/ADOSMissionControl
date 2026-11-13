/**
 * @module TooltipOwnTriggerTest
 * @description A tooltip never covers its own trigger: a side placement
 * with no room on that side drops below the trigger rather than being
 * clamped back over it, and `openOnTouch={false}` keeps a tap from opening
 * a hover-only overlay.
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tooltip } from "../tooltip";

const VIEWPORT_WIDTH = 412;
const VIEWPORT_HEIGHT = 915;

const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: VIEWPORT_WIDTH });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VIEWPORT_HEIGHT });
  // A 288 px fleet row at the top of a phone viewport; a 300 x 200 card.
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.getAttribute("role") === "tooltip") {
      return { x: 0, y: 0, top: 0, left: 0, right: 300, bottom: 200, width: 300, height: 200, toJSON: () => ({}) } as DOMRect;
    }
    return { x: 6, y: 236, top: 236, left: 6, right: 282, bottom: 288, width: 276, height: 52, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return this.getAttribute("role") === "tooltip" ? 300 : 276;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return this.getAttribute("role") === "tooltip" ? 200 : 52;
    },
  });
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
});

function renderRow(openOnTouch?: boolean) {
  render(
    <Tooltip
      content="Status card"
      position="right"
      multiline
      triggerClassName="relative block w-full"
      openOnTouch={openOnTouch}
    >
      <div role="option" aria-selected={false}>Alpha-01</div>
    </Tooltip>,
  );
  return screen.getByRole("option").parentElement!;
}

describe("Tooltip side placement without room", () => {
  it("drops below the trigger instead of covering it", () => {
    const trigger = renderRow();
    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    const overlay = screen.getByRole("tooltip");
    // Below the row's bottom edge (288), so the row stays clickable.
    expect(parseFloat(overlay.style.top)).toBeGreaterThanOrEqual(288);
  });
});

describe("Tooltip openOnTouch={false}", () => {
  it("does not open on a tap's emulated hover or focus", () => {
    const trigger = renderRow(false);
    act(() => {
      fireEvent.pointerEnter(trigger, { pointerType: "touch" });
      fireEvent.pointerDown(trigger, { pointerType: "touch" });
      fireEvent.mouseEnter(trigger);
      fireEvent.focus(trigger);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("still opens for a mouse hover", () => {
    const trigger = renderRow(false);
    act(() => {
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
      fireEvent.mouseEnter(trigger);
    });
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});
