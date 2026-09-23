/**
 * @license GPL-3.0-only
 *
 * The Power panel's live battery follows every sample, blanks once the link
 * goes quiet, and shows only what the FC measured: no cell count inferred from
 * pack voltage, no whole-pack value drawn as one cell, and no "-1 %".
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import { LiveBatteryDisplay } from "../LiveBatteryDisplay";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import type { BatteryData } from "@/lib/types";

function push(over: Partial<BatteryData>, ageMs = 0) {
  useTelemetryStore.getState().pushBattery({
    timestamp: Date.now() - ageMs,
    voltage: 14.4,
    current: 8,
    remaining: 55,
    consumed: 900,
    ...over,
  });
}

beforeEach(() => useTelemetryStore.getState().clear());
afterEach(cleanup);

describe("LiveBatteryDisplay", () => {
  it("follows new samples without the parent re-rendering", async () => {
    push({ current: 8 });
    render(<LiveBatteryDisplay />);
    expect(screen.getByText("8.0")).toBeTruthy();
    act(() => push({ current: 21.5 }));
    await waitFor(() => expect(screen.getByText("21.5")).toBeTruthy());
  });

  it("blanks a sample older than the telemetry staleness window", () => {
    push({ voltage: 16.2 }, TELEMETRY_STALE_MS + 1_000);
    render(<LiveBatteryDisplay />);
    expect(screen.queryByText("16.20")).toBeNull();
    expect(screen.getByText("No live battery data from the flight controller")).toBeTruthy();
  });

  it("never infers a cell count from pack voltage or draws a pack value as one cell", () => {
    // Analog monitor: the whole pack in voltages[0], no FC cell count.
    push({ voltage: 13.2, cellVoltages: [13.2] });
    render(<LiveBatteryDisplay />);
    expect(screen.queryByText(/^\dS/)).toBeNull();
    expect(screen.queryByText("Cell Voltages")).toBeNull();
    expect(screen.queryByText("13.20", { selector: "span.absolute" })).toBeNull();
  });

  it("uses the FC-reported cell count for a per-cell average", () => {
    push({ voltage: 13.2, cellCount: 4 });
    render(<LiveBatteryDisplay />);
    expect(screen.getByText("4S")).toBeTruthy();
    expect(screen.getByText("3.30 V")).toBeTruthy();
  });

  it("renders an unknown remaining, current and consumed as not measured", () => {
    push({ remaining: -1, current: undefined, consumed: undefined });
    render(<LiveBatteryDisplay />);
    expect(screen.queryByText(/-1/)).toBeNull();
    expect(screen.getAllByText("—").length).toBe(3);
  });
});
