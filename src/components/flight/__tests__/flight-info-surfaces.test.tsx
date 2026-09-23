/**
 * @license GPL-3.0-only
 *
 * Flight-tab surfaces that used to print defaults as readings: the drone info
 * card (0% battery, 0.0 V, "ArduCopter", a moving "enrolled" date, a heartbeat
 * as the last flight) and the mission overlay (distance and cross-track error
 * frozen after link loss).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { CompactInfoCards } from "@/components/flight/CompactInfoCards";
import { MissionExecutionOverlay } from "@/components/flight/MissionExecutionOverlay";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useMissionStore } from "@/stores/mission-store";
import { useDroneStore } from "@/stores/drone-store";
import { useHistoryStore } from "@/stores/history-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { AgentSystemInfoCard } from "@/components/flight/AgentSystemInfoCard";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import type { FleetDrone } from "@/lib/types";
import type { BatteryData } from "@/lib/types/telemetry";

function drone(over: Partial<FleetDrone> = {}): FleetDrone {
  return {
    id: "drone-info",
    name: "Alpha",
    status: "online",
    connectionState: "connected",
    flightMode: "STABILIZE",
    armState: "disarmed",
    lastHeartbeat: Date.now(),
    fcAttached: true,
    ...over,
  };
}

function battery(remaining: number): BatteryData {
  return { timestamp: Date.now(), voltage: 16.2, current: 3, remaining, consumed: 100 };
}

beforeEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
  useHistoryStore.setState({ records: [] });
  useDroneMetadataStore.setState({ profiles: {} });
});

describe("CompactInfoCards", () => {
  it("shows placeholders, not zeros, before an attached FC reports", () => {
    const { container } = renderWithIntl(<CompactInfoCards drone={drone()} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("0%");
    expect(text).not.toContain("0.0");
    expect(text).not.toContain("ArduCopter");
  });

  it("reads a -1 remaining as unknown", () => {
    const { container } = renderWithIntl(
      <CompactInfoCards drone={drone({ battery: battery(-1) })} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("16.2");
    expect(text).not.toContain("-1%");
    expect(text).not.toContain("0%");
  });

  it("shows a known remaining once, without a second bar label", () => {
    const { container } = renderWithIntl(
      <CompactInfoCards drone={drone({ battery: battery(64) })} />,
    );
    expect((container.textContent ?? "").match(/64%/g)).toHaveLength(1);
  });

  it("takes the last flight from flight history, not the heartbeat", () => {
    renderWithIntl(<CompactInfoCards drone={drone()} />);
    const lastFlight = screen.getByText("Last Flight").parentElement?.textContent ?? "";
    expect(lastFlight).toContain("—");
  });
});

describe("AgentSystemInfoCard", () => {
  function report(ageMs: number): void {
    useAgentSystemStore.setState({
      status: { install_status: "ok", kernel_release: "6.1.0" } as never,
      lastUpdatedAt: Date.now() - ageMs,
    });
  }

  it("presents a live report without a staleness note", () => {
    report(0);
    const { container } = renderWithIntl(<AgentSystemInfoCard />);
    expect(container.textContent).toContain("6.1.0");
    expect(container.textContent).not.toContain("Agent last seen");
  });

  it("labels a report from an agent that stopped answering", () => {
    report(50_000);
    const { container } = renderWithIntl(<AgentSystemInfoCard />);
    expect(container.textContent).toContain("Agent last seen 50s ago");
  });
});

describe("MissionExecutionOverlay", () => {
  function seedNav(ageMs: number): void {
    useTelemetryStore.getState().navController.push({
      timestamp: Date.now() - ageMs,
      navBearing: 0,
      targetBearing: 0,
      wpDist: 240,
      altError: 0,
      xtrackError: 3.2,
    });
  }

  beforeEach(() => {
    useDroneStore.setState({ flightMode: "AUTO", lastHeartbeat: Date.now() });
    useMissionStore.setState({ currentWaypoint: null });
  });

  it("shows live distance and cross-track error", () => {
    seedNav(0);
    const { container } = renderWithIntl(<MissionExecutionOverlay />);
    expect(container.textContent).toContain("240m");
    expect(container.textContent).toContain("3.2m");
  });

  it("blanks distance and cross-track error once the controller output is stale", () => {
    seedNav(TELEMETRY_STALE_MS + 1_000);
    const { container } = renderWithIntl(<MissionExecutionOverlay />);
    expect(container.textContent).not.toContain("240m");
    expect(container.textContent).not.toContain("3.2m");
  });

  it("hides when no live heartbeat backs the AUTO mode", () => {
    seedNav(0);
    useDroneStore.setState({ flightMode: "AUTO", lastHeartbeat: 0 });
    const { container } = renderWithIntl(<MissionExecutionOverlay />);
    expect(container.textContent).toBe("");
  });
});
