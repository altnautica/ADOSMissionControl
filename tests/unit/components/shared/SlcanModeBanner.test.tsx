/**
 * Component tests for SlcanModeBanner. Exercises the Resume MAVLink
 * button path that the SLCAN flash arbiter wires up via the store's
 * `exitFn` registry. The banner is the only operator-facing exit lever
 * for an active SLCAN session; the FC's `CAN_SLCAN_TIMOUT` idle watchdog
 * is a backstop, not an exit UX.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SlcanModeBanner } from "@/components/shared/SlcanModeBanner";
import { useSlcanModeStore } from "@/stores/slcan-mode-store";

describe("SlcanModeBanner — Resume MAVLink", () => {
  beforeEach(() => {
    useSlcanModeStore.getState().reset();
  });

  it("renders no banner in IDLE", () => {
    const { container } = render(<SlcanModeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the Resume MAVLink button when SLCAN_ACTIVE and exitFn is set", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 127,
    });
    useSlcanModeStore.getState().markActive();
    useSlcanModeStore.getState().setExitFn(async () => {});
    render(<SlcanModeBanner />);
    expect(screen.getByTestId("slcan-banner-resume")).toBeDefined();
  });

  it("falls back to passive copy when no exitFn is registered", () => {
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 127,
    });
    useSlcanModeStore.getState().markActive();
    render(<SlcanModeBanner />);
    expect(screen.queryByTestId("slcan-banner-resume")).toBeNull();
    expect(
      screen.getByText(/Resume MAVLink when the flash completes/i),
    ).toBeDefined();
  });

  it("invokes the registered exitFn on click", async () => {
    const exitFn = vi.fn().mockResolvedValue(undefined);
    useSlcanModeStore.getState().beginEntering({
      droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 127,
    });
    useSlcanModeStore.getState().markActive();
    useSlcanModeStore.getState().setExitFn(exitFn);
    render(<SlcanModeBanner />);
    fireEvent.click(screen.getByTestId("slcan-banner-resume"));
    await waitFor(() => expect(exitFn).toHaveBeenCalledTimes(1));
  });

  it("states the idle-revert window instead of a countdown, however long SLCAN stays busy", () => {
    vi.useFakeTimers();
    try {
      useSlcanModeStore.getState().beginEntering({
        droneId: "d", bus: 2, bitrate: 1_000_000, timeoutSec: 127,
      });
      useSlcanModeStore.getState().markActive();
      render(<SlcanModeBanner />);
      const banner = screen.getByTestId("slcan-banner-active");
      expect(banner.textContent).toContain("reverts to MAVLink after 127 s idle");
      // A flash keeping the port busy past the timeout does not revert it.
      act(() => {
        vi.advanceTimersByTime(200_000);
      });
      expect(banner.textContent).toContain("reverts to MAVLink after 127 s idle");
      expect(banner.textContent).not.toMatch(/\d\d:\d\d/);
    } finally {
      vi.useRealTimers();
    }
  });
});
