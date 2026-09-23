/**
 * The Debug panel keeps showing new vision-navigation values after the
 * telemetry rings fill, and the "Last Update" age keeps counting after the
 * stream stops.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useTelemetryStore } from "@/stores/telemetry-store";

const droneState = { selectedDroneId: "d1" };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));

import { DebugPanel } from "../DebugPanel";

/** Push and flush the coalesced version bump. */
async function push(fn: () => void) {
  await act(async () => {
    fn();
    await vi.advanceTimersByTimeAsync(50);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useTelemetryStore.getState().clear();
});
afterEach(() => vi.useRealTimers());

describe("DebugPanel", () => {
  it("shows new values once the ring is at capacity", async () => {
    const start = Date.now();
    await push(() => {
      for (let i = 0; i < 1000; i++) useTelemetryStore.getState().pushVioQuality(start - 1000 + i, 0.25);
    });
    render(<DebugPanel />);
    expect(screen.getByText("0.2500")).toBeTruthy();

    await push(() => useTelemetryStore.getState().pushVioQuality(Date.now(), 0.75));
    expect(screen.getByText("0.7500")).toBeTruthy();
  });

  it("ages the last update when the stream stops", async () => {
    await push(() => useTelemetryStore.getState().pushVioQuality(Date.now(), 0.5));
    render(<DebugPanel />);
    expect(screen.getByText("now")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(screen.queryByText("now")).toBeNull();
    expect(screen.getByText(/^7\.\ds$/)).toBeTruthy();
  });
});
