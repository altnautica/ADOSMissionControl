/**
 * @license GPL-3.0-only
 *
 * The calibration reboot banner goes away once the flight controller has
 * rebooted, even though heartbeats keep arriving after the reboot.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import messages from "../../../../../locales/en.json";
import { useDroneStore } from "@/stores/drone-store";
import { CalibrationRebootBanner } from "../CalibrationRebootBanner";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useDroneStore.setState({ lastHeartbeat: 0 });
});

describe("CalibrationRebootBanner", () => {
  it("dismisses after a heartbeat gap while 1 Hz heartbeats continue", () => {
    vi.useFakeTimers();
    let t = 1_000_000;
    act(() => useDroneStore.setState({ lastHeartbeat: t }));
    render(<CalibrationRebootBanner label="Compass calibration saved" onReboot={() => undefined} />, { wrapper: IntlWrapper });
    expect(screen.getByText("Reboot Required")).toBeTruthy();

    // The FC reboots: heartbeats stop for 6 s, then resume at 1 Hz.
    t += 6000;
    act(() => useDroneStore.setState({ lastHeartbeat: t }));
    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
        t += 1000;
        useDroneStore.setState({ lastHeartbeat: t });
      });
    }

    expect(screen.queryByText("Reboot Required")).toBeNull();
  });

  it("stays while heartbeats arrive without a gap", () => {
    vi.useFakeTimers();
    let t = 1_000_000;
    act(() => useDroneStore.setState({ lastHeartbeat: t }));
    render(<CalibrationRebootBanner label="Compass calibration saved" onReboot={() => undefined} />, { wrapper: IntlWrapper });
    for (let i = 0; i < 6; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
        t += 1000;
        useDroneStore.setState({ lastHeartbeat: t });
      });
    }
    expect(screen.getByText("Reboot Required")).toBeTruthy();
  });

  it("names the flight controller in full on the reboot button", () => {
    act(() => useDroneStore.setState({ lastHeartbeat: 1_000_000 }));
    render(<CalibrationRebootBanner label="Compass calibration saved" onReboot={() => undefined} />, { wrapper: IntlWrapper });
    expect(screen.getByRole("button", { name: messages.droneDetail.rebootFc })).toBeTruthy();
    expect(screen.queryByText("Reboot FC")).toBeNull();
  });
});
