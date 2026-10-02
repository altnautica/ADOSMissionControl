/**
 * @license GPL-3.0-only
 *
 * The reboot banner clears once the flight controller has rebooted (its boot
 * clock restarts), not on a mere link dropout, and a dismissal does not hide
 * a later parameter that also needs a reboot.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { RebootRequiredBanner } from "@/components/indicators/RebootRequiredBanner";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import type { DroneProtocol, SystemTimeCallback } from "@/lib/protocol/types";

function Harness() {
  const params = useParamSafetyStore((s) => s.rebootRequiredParams);
  const list = useMemo(() => Array.from(params), [params]);
  return <RebootRequiredBanner rebootParams={list} />;
}

let systemTime: SystemTimeCallback | null = null;

function selectFakeDrone() {
  const protocol = {
    onSystemTime: (cb: SystemTimeCallback) => {
      systemTime = cb;
      return () => { systemTime = null; };
    },
    reboot: vi.fn(async () => ({ success: true, resultCode: 0, message: "ok" })),
  } as Partial<DroneProtocol> as DroneProtocol;
  const drone = { id: "d1", name: "Drone 1", protocol } as Partial<ManagedDrone> as ManagedDrone;
  useDroneManager.setState({ drones: new Map([["d1", drone]]), selectedDroneId: "d1" });
}

function bootClock(ms: number) {
  act(() => {
    systemTime?.({ timestamp: Date.now(), timeUnixUsec: 0, timeBootMs: ms });
  });
}

describe("RebootRequiredBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    systemTime = null;
    selectFakeDrone();
    useParamSafetyStore.getState().clearRebootParams();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("clears the reboot params once the boot clock restarts", () => {
    useParamSafetyStore.getState().trackRebootParam("SERIAL1_PROTOCOL");
    renderWithIntl(<Harness />);
    expect(screen.getByText("SERIAL1_PROTOCOL")).toBeTruthy();

    bootClock(600_000);
    bootClock(601_000);
    bootClock(1_200); // the FC came back up
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(useParamSafetyStore.getState().rebootRequiredParams.size).toBe(0);
    expect(screen.queryByText("SERIAL1_PROTOCOL")).toBeNull();
  });

  it("keeps the reboot params across a link dropout without a reboot", () => {
    useParamSafetyStore.getState().trackRebootParam("SERIAL1_PROTOCOL");
    renderWithIntl(<Harness />);

    bootClock(600_000);
    // Ten seconds of silence, then the same boot clock carries on.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    bootClock(610_000);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(useParamSafetyStore.getState().rebootRequiredParams.size).toBe(1);
  });

  it("shows the banner again for a new reboot param after a dismissal", () => {
    useParamSafetyStore.getState().trackRebootParam("SERIAL1_PROTOCOL");
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("SERIAL1_PROTOCOL")).toBeNull();

    act(() => {
      useParamSafetyStore.getState().trackRebootParam("GPS_TYPE");
    });
    expect(screen.getByText("SERIAL1_PROTOCOL, GPS_TYPE")).toBeTruthy();
  });
});
