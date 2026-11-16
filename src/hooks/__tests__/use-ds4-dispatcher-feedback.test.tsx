/**
 * The cockpit's pad dispatcher rumbles on pilot-state changes by the shared
 * feedback rules: each new pilot state from the drone is compared with the
 * last, and the surface losing the pilot state (no fresh frame for the
 * spec's stale age) is critical.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const spies = vi.hoisted(() => ({ rumble: vi.fn((_pattern: string) => {}) }));

vi.mock("@/lib/input/pilot-stream", () => ({ sendPilotAction: vi.fn() }));
vi.mock("@/lib/video/webrtc-client", () => ({
  captureScreenshot: vi.fn(async () => new Blob(["png"])),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));
vi.mock("@/lib/input/ds4-feedback", () => ({
  rumble: (p: string) => spies.rumble(p),
  rumbleHoldTick: vi.fn(),
  setLightbar: vi.fn(async () => false),
  lightbarState: () => "disarmed",
  lightbarColour: () => [0, 0, 0],
}));

import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { CHIP_STALE_AFTER_MS } from "@/lib/hud/flight-state";
import { useControlsStore } from "@/stores/controls-store";
import { useInputStore } from "@/stores/input-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "feedback-drone";

function Dispatcher() {
  useDs4Dispatcher(DRONE);
  return null;
}

const BASE = { owner: "pilot", profile: "normal", control_mode: "ados", armed: true, avoid_state: "clear" };

function receive(patch: Record<string, unknown>): void {
  const raw = { ...BASE, ...patch };
  act(() => useNavStreamStore.getState().setPilot(DRONE, parsePilotState(raw)!, Date.now(), raw));
}

beforeEach(() => {
  vi.useFakeTimers();
  spies.rumble.mockClear();
  useControlsStore.setState({ bindings: null, tourVisible: false });
  useInputStore.setState({ buttons: [] });
  useNavStreamStore.setState({ byDrone: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useNavStreamStore.setState({ byDrone: {} });
});

describe("pad feedback from the pilot state", () => {
  it("rumbles a profile change, a warning and a lost controller by class", () => {
    render(<Dispatcher />);
    receive({});
    expect(spies.rumble).not.toHaveBeenCalled();
    receive({ profile: "sport" });
    expect(spies.rumble.mock.calls).toEqual([["mode_change"]]);
    receive({ profile: "sport", avoid_state: "blocked" });
    receive({ profile: "sport", avoid_state: "blocked", hold_reason: "controller-lost" });
    expect(spies.rumble.mock.calls).toEqual([["mode_change"], ["warning"], ["critical"]]);
  });

  it("an unchanged state at 10 Hz rumbles nothing", () => {
    render(<Dispatcher />);
    for (let i = 0; i < 5; i++) {
      receive({});
      act(() => vi.advanceTimersByTime(100));
    }
    expect(spies.rumble).not.toHaveBeenCalled();
  });

  it("losing the pilot state is critical once", () => {
    render(<Dispatcher />);
    receive({});
    act(() => vi.advanceTimersByTime(CHIP_STALE_AFTER_MS + 500));
    expect(spies.rumble.mock.calls).toEqual([["critical"]]);
    act(() => vi.advanceTimersByTime(5000));
    expect(spies.rumble.mock.calls).toEqual([["critical"]]);
    receive({ profile: "cine" });
    expect(spies.rumble.mock.calls).toEqual([["critical"]]);
  });
});
