/**
 * @license GPL-3.0-only
 *
 * Detaching the attitude HUD mounts a new canvas inside a popup window. The HUD
 * must measure and draw that canvas from the popup's own animation-frame loop
 * (the opener's loop stops when the main window is backgrounded), and draw the
 * inline canvas again after reattaching.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hud-draw", () => {
  const noop = () => {};
  return {
    drawSkyGround: noop, drawPitchLadder: noop, drawRollArc: noop, drawCrosshair: noop,
    drawSpeedTape: noop, drawAltTape: noop, drawHeadingCompass: noop, drawBatteryHud: noop,
    drawGpsAndMode: noop, drawArmedStatus: noop, drawSignalBars: noop, drawFlightTimer: noop,
  };
});

import { OverviewHud } from "@/components/flight/OverviewHud";

/** A 2D context stub that records which canvas drew. */
function stubCanvas(proto: HTMLCanvasElement, drawn: HTMLCanvasElement[]) {
  vi.spyOn(proto, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    return { setTransform: () => drawn.push(canvas) } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement["getContext"]);
}

function sizedRect(): DOMRect {
  return { width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) };
}

class NoopObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe("OverviewHud detach", () => {
  let iframe: HTMLIFrameElement;
  let popup: Window;
  let drawn: HTMLCanvasElement[];

  beforeEach(() => {
    drawn = [];
    iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    popup = iframe.contentWindow as Window;
    for (const w of [window, popup.window]) {
      Object.defineProperty(w, "ResizeObserver", {
        value: NoopObserver,
        configurable: true,
        writable: true,
      });
      vi.spyOn(w.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(sizedRect);
      stubCanvas(w.HTMLCanvasElement.prototype, drawn);
    }
    vi.spyOn(window, "open").mockImplementation(() => popup);
  });
  afterEach(() => {
    cleanup();
    iframe.remove();
    vi.restoreAllMocks();
  });

  it("draws the popup canvas from the popup's frame loop, then the inline canvas again", () => {
    // Deliver exactly one frame per request so the loop does not recurse.
    let windowFrames = 0;
    let popupFrames = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      if (windowFrames++ === 0) cb(0);
      return 1;
    });
    vi.spyOn(popup, "requestAnimationFrame").mockImplementation((cb) => {
      if (popupFrames++ === 0) cb(0);
      return 1;
    });

    const { container } = render(<OverviewHud />);
    const inline = container.querySelector("canvas") as HTMLCanvasElement;
    expect(drawn).toContain(inline);

    act(() => {
      fireEvent.doubleClick(inline.parentElement as HTMLElement);
    });
    const detached = popup.document.querySelector("canvas") as HTMLCanvasElement;
    expect(detached).toBeTruthy();
    expect(popupFrames).toBeGreaterThan(0);
    expect(drawn).toContain(detached);

    windowFrames = 0;
    drawn.length = 0;
    act(() => {
      fireEvent.doubleClick(detached.parentElement as HTMLElement);
    });
    const reattached = container.querySelector("canvas") as HTMLCanvasElement;
    expect(reattached).not.toBe(inline);
    expect(drawn).toContain(reattached);
  });
});
