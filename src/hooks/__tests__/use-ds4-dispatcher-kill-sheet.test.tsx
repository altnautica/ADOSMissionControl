/**
 * The pad's emergency stop hold (L2 + R2 + Circle) completed while the stop
 * sheet a key or the Skill Bar raised is still open: the hold is the
 * operator's confirmation, so the stop goes out once and the sheet closes.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("@/lib/input/ds4-feedback", () => ({
  rumble: vi.fn(),
  rumbleHoldTick: vi.fn(),
  setLightbar: vi.fn(async () => false),
  lightbarState: () => "idle",
  lightbarColour: () => [0, 0, 0],
}));
vi.mock("@/lib/video/webrtc-client", () => ({
  captureScreenshot: vi.fn(async () => new Blob(["png"])),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { activate, buildSkillContext, registerBuiltins } from "@/lib/skills";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useInputStore } from "@/stores/input-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { requestStop } from "@/components/cockpit/flight/FlightTopBar";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

const DRONE = "pad-drone";
const killSwitch = vi.fn(async (_on: boolean) => ({ success: true, resultCode: 0, message: "" }));

function Dispatcher() {
  useDs4Dispatcher(DRONE);
  return null;
}

function hold(controls: string[]): void {
  const down: boolean[] = [];
  for (const c of controls) down[WEB_BUTTON_INDEX[c]] = true;
  act(() => useInputStore.setState({ buttons: down }));
}

beforeEach(() => {
  vi.useFakeTimers();
  killSwitch.mockClear();
  registerBuiltins();
  const drone = {
    id: DRONE,
    name: "Pad One",
    protocol: {
      isConnected: true,
      getCapabilities: () => ({}) as ProtocolCapabilities,
      getFirmwareHandler: () => null,
      killSwitch,
    },
  } as unknown as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[DRONE, drone]]), selectedDroneId: DRONE });
  useDroneStore.setState({ armState: "armed", lastHeartbeat: Date.now() });
  useControlsStore.setState({ bindings: null, tourVisible: false });
  useInputStore.setState({ buttons: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useSkillConfirmStore.setState({ pending: null });
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("pad emergency stop with the stop sheet open", () => {
  it("sends the stop once and closes the sheet", async () => {
    render(<Dispatcher />);
    void activate("kill", buildSkillContext(DRONE));
    await act(async () => {});
    expect(useSkillConfirmStore.getState().pending?.policy.gesture).toBe("guarded");

    hold(["l2"]);
    hold(["l2", "r2"]);
    hold(["l2", "r2", "circle"]);
    act(() => vi.advanceTimersByTime(3200));
    hold([]);
    // Let the sheet's pipeline run through its re-read and the send.
    for (let i = 0; i < 5; i++) await act(async () => {});

    expect(killSwitch).toHaveBeenCalledTimes(1);
    expect(killSwitch).toHaveBeenCalledWith(true);
    expect(useSkillConfirmStore.getState().pending).toBeNull();
  });

  it("closes the top bar's stop sheet so it cannot send a second stop", async () => {
    // Clear the stop debounce the case above armed on the shared fake clock.
    act(() => vi.advanceTimersByTime(5000));
    render(<Dispatcher />);
    const sheet = requestStop(DRONE);
    await act(async () => {});
    expect(useSkillConfirmStore.getState().pending?.policy.gesture).toBe("guarded");

    hold(["l2"]);
    hold(["l2", "r2"]);
    hold(["l2", "r2", "circle"]);
    act(() => vi.advanceTimersByTime(3200));
    hold([]);
    for (let i = 0; i < 5; i++) await act(async () => {});

    expect(killSwitch).toHaveBeenCalledTimes(1);
    expect(useSkillConfirmStore.getState().pending).toBeNull();
    // Past the debounce, a sheet left up and then completed would send again.
    act(() => vi.advanceTimersByTime(2000));
    act(() => useSkillConfirmStore.getState().resolvePending(true));
    await act(async () => { await sheet; });
    expect(killSwitch).toHaveBeenCalledTimes(1);
  });
});
