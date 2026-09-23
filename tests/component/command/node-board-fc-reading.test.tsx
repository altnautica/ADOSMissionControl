/**
 * Board battery and mode cells render only what the node's flight controller
 * is reporting. The agent keeps heartbeating (liveness "live") after its FC
 * link dies, and its published vehicle state keeps sentinels (mode "",
 * remaining -1) plus the last values, so the row's agent liveness is not a
 * valid gate for FC readings.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../helpers/intl-wrapper";
import {
  BatteryCell,
  ModeReadout,
} from "@/components/command/nodes-view/StateCells";
import { fcReading } from "@/components/command/nodes-view/cell-primitives";
import { normalizeFleetTelemetry } from "@/hooks/use-command-agent-fleet";

afterEach(cleanup);

// Vehicle state as the agent publishes it before any FC has spoken
// (ados-mavlink-router state.rs: armed false, mode "", remaining -1).
const AGENT_EMPTY_VEHICLE = {
  armed: false,
  mode: "",
  battery: { voltage: 0, current: 0, remaining: -1 },
};

// Last values the agent keeps after the FC link died mid-flight.
const FROZEN_FLIGHT = {
  armed: true,
  mode: "AUTO",
  battery: { voltage: 15.2, current: 12, remaining: 72 },
};

function droneRow(fcReachable: boolean) {
  return {
    liveness: "live" as const,
    profile: "drone" as const,
    system: { fcReachable } as Parameters<typeof fcReading>[0]["system"],
  };
}

describe("node board FC readings", () => {
  it("renders agent sentinels as not reported, never -1% or DISARMED", () => {
    const telemetry = normalizeFleetTelemetry(AGENT_EMPTY_VEHICLE);
    const reading = fcReading(droneRow(true));
    renderWithIntl(
      <>
        <BatteryCell telemetry={telemetry} reading={reading} />
        <ModeReadout telemetry={telemetry} reading={reading} />
      </>,
    );
    expect(screen.queryByText(/-1%/)).toBeNull();
    expect(screen.queryByText(/disarmed/i)).toBeNull();
    expect(screen.getByText("The node reports no battery")).toBeTruthy();
    expect(screen.getByText("The node reports no flight mode")).toBeTruthy();
  });

  it("hides frozen FC values when the agent is live but the FC is unreachable", () => {
    const telemetry = normalizeFleetTelemetry(FROZEN_FLIGHT);
    const reading = fcReading(droneRow(false));
    renderWithIntl(
      <>
        <BatteryCell telemetry={telemetry} reading={reading} />
        <ModeReadout telemetry={telemetry} reading={reading} />
      </>,
    );
    expect(screen.queryByText("72%")).toBeNull();
    expect(screen.queryByText("AUTO")).toBeNull();
    expect(screen.queryByText(/^armed$/i)).toBeNull();
    expect(
      screen.getAllByText(/Flight controller not reachable/).length,
    ).toBe(2);
  });

  it("shows no FC readings for a node that does not fly", () => {
    const telemetry = normalizeFleetTelemetry(FROZEN_FLIGHT);
    const reading = fcReading({ ...droneRow(true), profile: "ground-station" });
    renderWithIntl(<BatteryCell telemetry={telemetry} reading={reading} />);
    expect(screen.queryByText("72%")).toBeNull();
    expect(screen.getByText(/This node does not fly/)).toBeTruthy();
  });

  it("shows live FC readings when the FC is reachable", () => {
    const telemetry = normalizeFleetTelemetry(FROZEN_FLIGHT);
    const reading = fcReading(droneRow(true));
    renderWithIntl(
      <>
        <BatteryCell telemetry={telemetry} reading={reading} />
        <ModeReadout telemetry={telemetry} reading={reading} />
      </>,
    );
    expect(screen.getByText("72%")).toBeTruthy();
    expect(screen.getByText("AUTO")).toBeTruthy();
  });
});
