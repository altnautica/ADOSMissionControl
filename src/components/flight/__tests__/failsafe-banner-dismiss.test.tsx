/**
 * @license GPL-3.0-only
 *
 * Dismissing the failsafe banner acknowledges the conditions on screen for one
 * drone. It must never hide a new condition, an escalation, another drone's
 * alerts, or an emergency for longer than a short snooze.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FailsafeAlertBanner } from "@/components/flight/FailsafeAlertBanner";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const T0 = 1_700_000_000_000;
let now = T0;

function seedBattery(remaining: number) {
  useTelemetryStore.getState().clear();
  useTelemetryStore.getState().pushBattery({
    timestamp: now,
    voltage: 15.2,
    current: 10,
    remaining,
    consumed: 100,
  });
}

function dismiss() {
  fireEvent.click(screen.getByRole("button", { name: "Dismiss failsafe alerts" }));
}

describe("FailsafeAlertBanner dismissal", () => {
  beforeEach(() => {
    now = T0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    useDroneStore.setState({ connectionState: "connected", systemStatus: 3 });
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    seedBattery(20);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useTelemetryStore.getState().clear();
    useDroneStore.setState({ connectionState: "disconnected", systemStatus: 0 });
    useDroneManager.setState({ selectedDroneId: null });
  });

  it("keeps a dismissed warning hidden while nothing changes", () => {
    render(<FailsafeAlertBanner />);
    expect(screen.getByText("Battery Low: 20%")).toBeTruthy();
    dismiss();
    now = T0 + 20_000;
    act(() => seedBattery(20));
    expect(screen.queryByText("Battery Low: 20%")).toBeNull();
  });

  it("re-shows at once when the FC declares an emergency after a dismissal", () => {
    render(<FailsafeAlertBanner />);
    dismiss();
    act(() => useDroneStore.setState({ systemStatus: 6 }));
    expect(screen.getByText("EMERGENCY STATE")).toBeTruthy();
  });

  it("re-shows at once when a dismissed condition escalates", () => {
    render(<FailsafeAlertBanner />);
    dismiss();
    act(() => seedBattery(12));
    expect(screen.getByText("Battery Critical: 12%")).toBeTruthy();
  });

  it("shows another drone's alerts after a dismissal on the first drone", () => {
    render(<FailsafeAlertBanner />);
    dismiss();
    act(() => useDroneManager.setState({ selectedDroneId: "drone-b" }));
    expect(screen.getByText("Battery Low: 20%")).toBeTruthy();
  });

  it("snoozes an emergency for at most ten seconds", () => {
    useDroneStore.setState({ systemStatus: 6 });
    render(<FailsafeAlertBanner />);
    dismiss();
    expect(screen.queryByText("EMERGENCY STATE")).toBeNull();
    now = T0 + 11_000;
    act(() => seedBattery(20));
    expect(screen.getByText("EMERGENCY STATE")).toBeTruthy();
  });

  it("shows flight termination as an emergency", () => {
    useDroneStore.setState({ systemStatus: 8 });
    render(<FailsafeAlertBanner />);
    expect(screen.getByText("FLIGHT TERMINATION")).toBeTruthy();
  });
});
