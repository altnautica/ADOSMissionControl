/**
 * @license GPL-3.0-only
 *
 * The on-screen sticks never keep streaming a deflection nobody holds: a
 * lost pointer capture centres the pad, and a pad that unmounts mid-touch
 * (a controller connecting) stops the input frames and releases the sticks.
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
import { PILOT_INPUT_PERIOD_MS, sendPilotInput, sendPilotRelease, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useCockpitPrefsStore } from "@/stores/cockpit-prefs-store";
import { OnScreenSticks } from "../OnScreenSticks";

const DRONE = "sticks-release";
const input = vi.mocked(sendPilotInput);
const release = vi.mocked(sendPilotRelease);

function renderSticks() {
  return render(
    <CockpitLayoutContext.Provider value={{ width: 1280, height: 800, widthClass: "expanded" }}>
      <OnScreenSticks droneId={DRONE} />
    </CockpitLayoutContext.Provider>,
  );
}

/** Press the right pad fully forward. */
function deflect(): HTMLElement {
  const pad = screen.getByTestId("on-screen-stick-right");
  pad.setPointerCapture = () => {};
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 120, right: 120, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.pointerDown(pad, { clientX: 60, clientY: 0, pointerId: 1 });
  act(() => {
    vi.advanceTimersByTime(PILOT_INPUT_PERIOD_MS * 2);
  });
  const last = input.mock.calls.at(-1)?.[0] as number[] | undefined;
  expect(last?.[1]).toBeCloseTo(1, 5);
  return pad;
}

beforeEach(() => {
  vi.useFakeTimers();
  input.mockClear();
  release.mockClear();
  useCockpitPrefsStore.setState({ onScreenSticks: true });
  usePilotLinkStore.setState({ connected: true, controlMode: "ados" });
  usePadStatusStore.setState({ connected: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("on-screen sticks release", () => {
  it("centres and stops on a lost pointer capture", () => {
    renderSticks();
    const pad = deflect();
    fireEvent(pad, new Event("lostpointercapture", { bubbles: true }));
    expect(release).toHaveBeenCalled();
    input.mockClear();
    act(() => {
      vi.advanceTimersByTime(PILOT_INPUT_PERIOD_MS * 5);
    });
    expect(input).not.toHaveBeenCalled();
    expect(pad.getAttribute("aria-valuenow")).toBe("0");
  });

  it("stops streaming and releases when the pads unmount mid-touch", () => {
    renderSticks();
    deflect();
    act(() => usePadStatusStore.setState({ connected: true }));
    expect(screen.queryByTestId("on-screen-stick-right")).toBeNull();
    expect(release).toHaveBeenCalled();
    input.mockClear();
    act(() => {
      vi.advanceTimersByTime(PILOT_INPUT_PERIOD_MS * 5);
    });
    expect(input).not.toHaveBeenCalled();
  });
});
