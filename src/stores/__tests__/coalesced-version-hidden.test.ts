/**
 * @license GPL-3.0-only
 *
 * A hidden document never runs requestAnimationFrame callbacks, but a detached
 * HUD or telemetry popup is still on screen. The bumper must keep notifying on
 * a timer while the opener is hidden.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVersionBumper } from "@/stores/coalesced-version";

let visibility: DocumentVisibilityState = "visible";

describe("createVersionBumper while the document is hidden", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    // A suspended frame queue: frames are requested but never delivered.
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bumps on a timer when scheduled from a hidden document", () => {
    const bump = vi.fn();
    const bumper = createVersionBumper(bump);
    visibility = "hidden";
    bumper.scheduleVersionBump();
    vi.advanceTimersByTime(20);
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it("moves a frame requested before hiding onto the timer", () => {
    const bump = vi.fn();
    const bumper = createVersionBumper(bump);
    bumper.scheduleVersionBump();
    visibility = "hidden";
    bumper.scheduleVersionBump();
    vi.advanceTimersByTime(20);
    expect(bump).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("coalesces to one frame while visible", () => {
    const bump = vi.fn();
    const bumper = createVersionBumper(bump);
    bumper.scheduleVersionBump();
    bumper.scheduleVersionBump();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
