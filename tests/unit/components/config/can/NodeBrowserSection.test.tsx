/**
 * NodeBrowserSection: departed nodes are greyed with their last-seen age and
 * swept out while the browser is mounted; pausing auto-refresh freezes the
 * rows instead of emptying the table.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../helpers/intl-wrapper";
import { useDroneCanNodeStore, type NodeEntry } from "@/stores/dronecan/node-store";
import { NodeBrowserSection } from "@/components/config/can/NodeBrowserSection";

function entry(nodeId: number, lastSeen: number): NodeEntry {
  return {
    nodeId,
    lastSeen,
    lastStatus: { uptime_sec: 100, health: 0, mode: 0, sub_mode: 0, vendor_specific_status_code: 0 },
    statusHistory: [],
  } as NodeEntry;
}

describe("NodeBrowserSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    useDroneCanNodeStore.setState({
      nodes: new Map(),
      _version: 0,
      _tickTimer: null,
      _subscriberCount: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("greys a node that stopped reporting and shows how long ago it was heard", () => {
    const now = Date.now();
    useDroneCanNodeStore.setState({
      nodes: new Map([
        [10, entry(10, now)],
        [11, entry(11, now - 5_000)],
      ]),
      _version: 1,
    });
    renderWithIntl(<NodeBrowserSection />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].getAttribute("data-online")).toBe("true");
    expect(rows[1].getAttribute("data-online")).toBe("false");
    expect(rows[1].textContent).toContain("5s ago");
  });

  it("sweeps a node that left the bus while the browser is mounted", () => {
    useDroneCanNodeStore.setState({
      nodes: new Map([[12, entry(12, Date.now() - 11_000)]]),
      _version: 1,
    });
    renderWithIntl(<NodeBrowserSection />);
    expect(screen.getByText("12")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.queryByText("12")).toBeNull();
  });

  it("keeps the last rows on screen when auto-refresh is paused", () => {
    useDroneCanNodeStore.setState({
      nodes: new Map([[13, entry(13, Date.now())]]),
      _version: 1,
    });
    renderWithIntl(<NodeBrowserSection />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("13")).toBeDefined();
  });
});
