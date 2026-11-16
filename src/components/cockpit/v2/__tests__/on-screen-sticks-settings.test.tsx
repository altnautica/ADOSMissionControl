/**
 * @license GPL-3.0-only
 *
 * The on-screen sticks honour the operator's controller settings: the
 * deadzone (Settings › Input) conditions a touch and is drawn as a ring on
 * each pad, and the stick mode decides which pad flies forward and which
 * climbs, as on a controller.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/input/pilot-stream", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/input/pilot-stream")>();
  return {
    ...real,
    sendPilotInput: vi.fn(),
    sendPilotRelease: vi.fn(),
    sticksRouteToPilot: () => true,
  };
});

import { CockpitLayoutContext } from "@/hooks/use-cockpit-width-class";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { PILOT_INPUT_PERIOD_MS, sendPilotInput, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useCockpitPrefsStore } from "@/stores/cockpit-prefs-store";
import { useInputStore } from "@/stores/input-store";
import { OnScreenSticks } from "../OnScreenSticks";

const input = vi.mocked(sendPilotInput);
const PAD = layoutSpec.on_screen_sticks.pad_size;

function renderSticks() {
  return render(
    <CockpitLayoutContext.Provider value={{ width: 1280, height: 800, widthClass: "expanded" }}>
      <OnScreenSticks droneId="sticks-settings" />
    </CockpitLayoutContext.Provider>,
  );
}

/** Touch a 120 px pad at an offset from its centre and return the last frame's axes. */
function touch(side: "left" | "right", dx: number, dy: number): number[] {
  const pad = screen.getByTestId(`on-screen-stick-${side}`);
  pad.setPointerCapture = () => {};
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 120, right: 120, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.pointerDown(pad, { clientX: 60 + dx, clientY: 60 + dy, pointerId: 1 });
  act(() => {
    vi.advanceTimersByTime(PILOT_INPUT_PERIOD_MS * 2);
  });
  return ((input.mock.calls.at(-1)?.[0] as number[] | undefined) ?? []).map((v) => v + 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  input.mockClear();
  useCockpitPrefsStore.setState({ onScreenSticks: true });
  usePilotLinkStore.setState({ connected: true, controlMode: "ados" });
  usePadStatusStore.setState({ connected: false });
  useInputStore.setState({ deadzone: 0.08, txMode: 2 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("on-screen sticks · operator settings", () => {
  it("a touch inside the operator's wider deadzone reads centred", () => {
    useInputStore.setState({ deadzone: 0.2 });
    renderSticks();
    // 15 % of the radius: outside the default 0.08, inside 0.2.
    expect(touch("right", 0, -9)).toEqual([0, 0, 0, 0]);
  });

  it("draws the deadzone ring at the operator's deadzone", () => {
    useInputStore.setState({ deadzone: 0.2 });
    renderSticks();
    for (const side of ["left", "right"]) {
      const ring = screen.getByTestId(`on-screen-stick-${side}-deadzone`);
      expect(parseFloat(ring.style.width)).toBeCloseTo(0.2 * PAD, 5);
      expect(parseFloat(ring.style.height)).toBeCloseTo(0.2 * PAD, 5);
    }
  });

  it("in Mode 1 the left pad up flies forward, and the pads say so", () => {
    useInputStore.setState({ txMode: 1 });
    renderSticks();
    expect(screen.getByTestId("on-screen-stick-left").getAttribute("aria-label")).toBe("Left stick: forward, back and turn");
    expect(screen.getByTestId("on-screen-stick-right").getAttribute("aria-label")).toBe("Right stick: climb, descend and sideways");
    const axes = touch("left", 0, -60);
    expect(axes[1]).toBeCloseTo(1, 5);
    expect(axes[2]).toBeCloseTo(0, 5);
  });

  it("in Mode 2 the left pad up climbs", () => {
    renderSticks();
    const axes = touch("left", 0, -60);
    expect(axes[1]).toBeCloseTo(0, 5);
    expect(axes[2]).toBeCloseTo(1, 5);
  });
});
