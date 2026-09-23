/**
 * @license GPL-3.0-only
 *
 * The reboot banner clears once the flight controller has rebooted (the
 * heartbeat resumes after a gap) even though heartbeats keep arriving, and a
 * dismissal does not hide a later parameter that also needs a reboot.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { RebootRequiredBanner } from "@/components/indicators/RebootRequiredBanner";
import { useDroneStore } from "@/stores/drone-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";

function Harness() {
  const params = useParamSafetyStore((s) => s.rebootRequiredParams);
  const list = useMemo(() => Array.from(params), [params]);
  return <RebootRequiredBanner rebootParams={list} />;
}

function heartbeatAt(ms: number) {
  act(() => {
    useDroneStore.setState({ lastHeartbeat: ms });
  });
}

describe("RebootRequiredBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDroneStore.setState({ lastHeartbeat: 0 });
    useParamSafetyStore.getState().clearRebootParams();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("clears the reboot params after a reboot while heartbeats keep arriving", () => {
    useParamSafetyStore.getState().trackRebootParam("SERIAL1_PROTOCOL");
    renderWithIntl(<Harness />);
    expect(screen.getByText("SERIAL1_PROTOCOL")).toBeTruthy();

    heartbeatAt(1_000);
    heartbeatAt(2_000);
    // Reboot: the heartbeat stops for several seconds, then resumes at 1 Hz.
    heartbeatAt(8_000);
    for (let t = 9_000; t <= 12_000; t += 1_000) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      heartbeatAt(t);
    }
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(useParamSafetyStore.getState().rebootRequiredParams.size).toBe(0);
    expect(screen.queryByText("SERIAL1_PROTOCOL")).toBeNull();
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
