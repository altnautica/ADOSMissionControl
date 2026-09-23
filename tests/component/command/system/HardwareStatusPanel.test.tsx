/**
 * HardwareStatusPanel: every hardware scan ends (an empty or failed scan never
 * leaves the spinner up), and a stale node's FC link reads as last known,
 * never as a live green "FC connected".
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../../helpers/intl-wrapper";
import type { Freshness } from "@/lib/agent/freshness";
import type { PeripheralScanOutcome } from "@/stores/agent-peripherals-store";

const h = vi.hoisted(() => ({
  connected: false,
  scan: vi.fn<() => Promise<PeripheralScanOutcome>>(),
  status: null as Record<string, unknown> | null,
  freshness: { state: "live", elapsedMs: 0, label: "0s ago" } as Freshness,
}));

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) => sel({ connected: h.connected }),
}));

vi.mock("@/stores/agent-peripherals-store", () => ({
  useAgentPeripheralsStore: (sel: (s: unknown) => unknown) =>
    sel({ peripherals: [], scanPeripherals: h.scan }),
}));

vi.mock("@/stores/agent-system-store", () => ({
  useAgentSystemStore: (sel: (s: unknown) => unknown) =>
    sel({ status: h.status, resources: null }),
}));

vi.mock("@/lib/agent/freshness", () => ({
  useFreshness: () => h.freshness,
}));

vi.mock("@/components/command/shared/BoardPinoutView", () => ({
  BoardPinoutView: () => <div data-testid="board-pinout" />,
}));

vi.mock("@/components/command/system/CalibrationLauncher", () => ({
  CalibrationLauncher: () => <div data-testid="calibration-launcher" />,
}));

vi.mock("@/components/command/system/shared", () => ({
  CollapsibleSection: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section data-testid="collapsible" data-title={title}>
      {children}
    </section>
  ),
  DeviceCard: () => <div data-testid="device-card" />,
  NpuBadge: () => <span data-testid="npu-badge" />,
  ScanProgress: () => <div data-testid="scan-progress" />,
  StatBox: () => <div data-testid="stat-box" />,
}));

import { HardwareStatusPanel } from "@/components/command/system/HardwareStatusPanel";

beforeEach(() => {
  h.connected = false;
  h.scan.mockReset();
  h.status = null;
  h.freshness = { state: "live", elapsedMs: 0, label: "0s ago" };
});

afterEach(cleanup);

describe("HardwareStatusPanel scan", () => {
  it("stops scanning when the scan finds no devices", async () => {
    h.connected = true;
    h.scan.mockResolvedValue("done");
    renderWithIntl(<HardwareStatusPanel />);

    await waitFor(() => expect(screen.queryByTestId("scan-progress")).toBeNull());
    expect(screen.getByText("No peripherals detected")).toBeDefined();
  });

  it("says the scan did not complete when it fails", async () => {
    h.connected = true;
    h.scan.mockResolvedValue("failed");
    renderWithIntl(<HardwareStatusPanel />);

    expect(await screen.findByText(/scan did not complete/)).toBeDefined();
    expect(screen.queryByTestId("scan-progress")).toBeNull();
  });
});

describe("HardwareStatusPanel FC link freshness", () => {
  const liveStatus = {
    version: "1.0.0",
    fc_connected: true,
    transport_open: true,
    mavlink_alive: true,
    heartbeat_age_s: 0.4,
  };

  it("reads a stale node's FC link as last known, not live", () => {
    h.status = liveStatus;
    h.freshness = { state: "stale", elapsedMs: 50_000, label: "50s ago" };
    renderWithIntl(<HardwareStatusPanel />);

    const line = screen.getByText(/FC Connected/);
    expect(line.textContent).toContain("last known, 50s ago");
    expect(line.className).not.toContain("text-status-success");
    expect(screen.queryByText(/^MAVLink /)).toBeNull();
  });

  it("reads a live node's FC link as connected", () => {
    h.status = liveStatus;
    renderWithIntl(<HardwareStatusPanel />);

    expect(screen.getByText("FC Connected").className).toContain("text-status-success");
  });
});
