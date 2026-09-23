/**
 * @module shared/rc-input-card-freshness.test
 * @description The RC input card shows stick positions only from a fresh or
 * recently stale RC sample, and never renders the MAVLink "unknown" RSSI
 * (255) as a reading.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RcInputCard } from "../RcInputCard";
import { useTelemetryStore } from "@/stores/telemetry-store";

function pushRc(rssi: number) {
  useTelemetryStore.getState().pushRc({
    timestamp: Date.now(),
    channels: [1500, 1600, 1100, 1900, 1000, 1000, 1000, 1000],
    rssi,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useTelemetryStore.getState().clear();
});

describe("RcInputCard", () => {
  it("renders a fresh sample with the RSSI scale", () => {
    pushRc(200);
    render(<RcInputCard />);
    expect(screen.getByText("1600")).toBeTruthy();
    expect(screen.getByText("200/254")).toBeTruthy();
  });

  it("renders RSSI 255 as unknown", () => {
    pushRc(255);
    render(<RcInputCard />);
    expect(screen.queryByText(/255/)).toBeNull();
    expect(screen.getByText("--")).toBeTruthy();
  });

  it("drops the frozen sample once the RC link is lost", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    pushRc(200);
    render(<RcInputCard />);
    expect(screen.getByText("1600")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(8000));
    expect(screen.queryByText("1600")).toBeNull();
    expect(screen.queryByText("200/254")).toBeNull();
    expect(screen.getByText("RC signal lost")).toBeTruthy();
  });
});
