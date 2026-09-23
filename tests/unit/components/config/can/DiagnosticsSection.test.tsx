/**
 * Smoke tests for DiagnosticsSection. Verifies the gauge row renders the
 * top-level counters and the per-node row expands to surface
 * GetTransportStats reads.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../../../helpers/intl-wrapper";
import { useDroneCanBusStore } from "@/stores/dronecan/bus-store";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";

import { DiagnosticsSection } from "@/components/config/can/DiagnosticsSection";

describe("DiagnosticsSection", () => {
  beforeEach(() => {
    useDroneCanBusStore.setState({
      counters: { fps: 42, errorsPs: 1, bytesIn: 0, bytesOut: 0 },
      _version: 1,
    } as never);
    useDroneCanNodeStore.setState({ nodes: new Map(), _version: 0 } as never);
  });

  it("renders the top-row gauges, with unmeasured bus-off as a dash", () => {
    renderWithIntl(<DiagnosticsSection client={null} />);
    expect(screen.queryByTestId("diagnostics-bus-load")).toBeNull();
    expect(screen.getByTestId("diagnostics-fps").textContent).toContain("42");
    expect(screen.getByTestId("diagnostics-errors-ps").textContent).toContain("1");
    expect(screen.getByTestId("diagnostics-bus-off").textContent).toContain("—");
  });

  it("renders the per-node table with seeded nodes", () => {
    const store = useDroneCanNodeStore.getState();
    store.upsertStatus(11, {
      uptime_sec: 10,
      health: 0,
      mode: 0,
      vendor_specific_status_code: 0,
    } as never);
    renderWithIntl(<DiagnosticsSection client={null} />);
    expect(screen.getByText(/Per-node transport stats/i)).toBeDefined();
    // The node row renders the numeric id.
    expect(screen.getByText("11")).toBeDefined();
  });

  it("expands a node row and calls getTransportStats on the mock client", async () => {
    const store = useDroneCanNodeStore.getState();
    store.upsertStatus(11, {
      uptime_sec: 10,
      health: 0,
      mode: 0,
      vendor_specific_status_code: 0,
    } as never);
    const client = {
      getTransportStats: vi.fn(async () => ({
        transfer_count: BigInt(42),
        message_count: BigInt(40),
        error_count: BigInt(1),
        can_iface_stats: [],
      })),
    };
    renderWithIntl(<DiagnosticsSection client={client} />);
    // Click the expand toggle on the row.
    const toggle = screen.getAllByLabelText("Toggle")[0];
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(client.getTransportStats).toHaveBeenCalledWith(11);
    });
  });
});
