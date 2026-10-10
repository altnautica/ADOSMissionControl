/**
 * @module cockpit/hud-layer-frame.test
 * @description The HUD derives its telemetry once per animation frame, not
 * once per instrument and not once per telemetry sample, and its
 * screen-reader summary refreshes at most once a second.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as HudReadingsModule from "@/lib/hud-readings";
import type { HudSamples } from "@/lib/hud-readings";

const derive = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/hud-readings", async (importOriginal) => {
  const actual = await importOriginal<typeof HudReadingsModule>();
  return {
    ...actual,
    deriveHudInstruments: (samples: HudSamples) => {
      derive.calls += 1;
      return actual.deriveHudInstruments(samples);
    },
  };
});

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { HudLayer } from "@/components/cockpit/HudLayer";
import { HUD_SUMMARY_PERIOD_MS } from "@/components/cockpit/hud/HudSummary";
import { useTelemetryStore } from "@/stores/telemetry-store";

/** Manually driven animation frames. */
let frames: FrameRequestCallback[] = [];
function runFrame() {
  const pending = frames;
  frames = [];
  act(() => {
    for (const cb of pending) cb(performance.now());
  });
}

function pushAttitude(roll: number, timestamp: number) {
  useTelemetryStore.getState().pushAttitude({
    timestamp,
    roll,
    pitch: 2,
    yaw: 0,
    rollSpeed: 0,
    pitchSpeed: 0,
    yawSpeed: 0,
  });
}

describe("HudLayer frame cadence", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    derive.calls = 0;
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("derives once per frame however many samples or instruments there are", () => {
    pushAttitude(1, Date.now() - 100);
    renderWithIntl(<HudLayer />);
    // One derivation seeds the first paint for every instrument in the layer.
    expect(derive.calls).toBe(1);

    // A burst of telemetry between frames re-derives nothing by itself.
    for (let i = 0; i < 20; i++) pushAttitude(10 + i, Date.now() - 20 + i);
    expect(derive.calls).toBe(1);

    runFrame();
    expect(derive.calls).toBe(2);
    expect(
      document.querySelector("[data-testid='hud-horizon']")?.getAttribute("transform"),
    ).toContain("rotate(-29 600 350)");
  });

  it("refreshes the screen-reader summary at most once a second", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    pushAttitude(10, Date.now());
    renderWithIntl(<HudLayer />);
    const summary = screen.getByTestId("hud-summary");
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.getAttribute("aria-live")).toBe("polite");
    expect(summary.textContent).toContain("roll 10°");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    pushAttitude(25, Date.now());
    runFrame();
    // The drawn horizon follows the frame; the text waits for its period.
    expect(
      document.querySelector("[data-testid='hud-horizon']")?.getAttribute("transform"),
    ).toContain("rotate(-25 600 350)");
    expect(summary.textContent).toContain("roll 10°");

    act(() => {
      vi.advanceTimersByTime(HUD_SUMMARY_PERIOD_MS - 100);
    });
    expect(summary.textContent).toContain("roll 25°");
  });
});
