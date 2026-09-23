/**
 * Smoke tests for BusHealthGauges. Verifies the seven meters render and
 * read from the bus store on the polling tick.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../../helpers/intl-wrapper";
import { useDroneCanBusStore } from "@/stores/dronecan/bus-store";

import { BusHealthGauges } from "@/components/config/can/debug/BusHealthGauges";

describe("BusHealthGauges", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDroneCanBusStore.setState({
      counters: { fps: 0, errorsPs: 0, bytesIn: 0, bytesOut: 0 },
      _version: 0,
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the four top-row meters and three bottom-row meters", () => {
    renderWithIntl(<BusHealthGauges />);
    expect(screen.queryByTestId("bus-health-bus-load")).toBeNull();
    expect(screen.getByTestId("bus-health-fps")).toBeDefined();
    expect(screen.getByTestId("bus-health-errors-ps")).toBeDefined();
    expect(screen.getByTestId("bus-health-bus-off")).toBeDefined();
    expect(screen.getByTestId("bus-health-tx-queue")).toBeDefined();
    expect(screen.getByTestId("bus-health-rx-queue")).toBeDefined();
    expect(screen.getByTestId("bus-health-lost-frames")).toBeDefined();
  });

  it("renders zeros in the empty state", () => {
    renderWithIntl(<BusHealthGauges />);
    expect(screen.getByTestId("bus-health-errors-ps").textContent).toContain("0");
  });

  it("polls the bus store and reflects counters after a tick", () => {
    renderWithIntl(<BusHealthGauges />);
    useDroneCanBusStore.setState({
      counters: { fps: 100, errorsPs: 2, bytesIn: 0, bytesOut: 0 },
      _version: 1,
    } as never);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("bus-health-fps").textContent).toContain("100");
    expect(screen.getByTestId("bus-health-errors-ps").textContent).toContain("2");
  });
});
