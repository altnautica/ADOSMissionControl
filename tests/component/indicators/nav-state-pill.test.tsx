import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavStatePill } from "@/components/indicators/NavStatePill";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { selectTestProtocol } from "../../helpers/selected-drone";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import {
  inavNavActionLabel,
  inavNavModeLabel,
  inavNavStateLabel,
} from "@/lib/protocol/msp/inav-nav-status";
import type { DroneProtocol } from "@/lib/protocol/types";

const inavProtocol = {
  getVehicleInfo: () => ({ firmwareType: "inav", vehicleClass: "copter" }),
} as unknown as DroneProtocol;

describe("iNav MSP_NAV_STATUS tables (navigation.h)", () => {
  it.each<[number, string]>([
    [0, "NONE"],
    [1, "RTH_START"],
    [2, "RTH_ENROUTE"],
    [3, "HOLD_INFINIT"],
    [5, "WP_ENROUTE"],
    [9, "LAND_IN_PROGRESS"],
    [13, "HOVER_ABOVE_HOME"],
    [14, "EMERGENCY_LANDING"],
    [15, "RTH_CLIMB"],
  ])("navSystemStatus_State_e %i is %s", (value, label) => {
    expect(inavNavStateLabel(value)).toBe(label);
  });

  it.each<[number, string]>([
    [1, "WAYPOINT"],
    [3, "HOLD_TIME"],
    [4, "RTH"],
    [5, "SET_POI"],
    [6, "JUMP"],
    [7, "SET_HEAD"],
    [8, "LAND"],
  ])("navWaypointActions_e %i is %s", (value, label) => {
    expect(inavNavActionLabel(value)).toBe(label);
  });

  it.each<[number, string]>([
    [0, "NONE"],
    [1, "HOLD"],
    [2, "RTH"],
    [3, "NAV"],
    [15, "EMERGENCY"],
  ])("navSystemStatus_Mode_e %i is %s", (value, label) => {
    expect(inavNavModeLabel(value)).toBe(label);
  });
});

describe("NavStatePill", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    selectTestProtocol(inavProtocol);
  });

  it("shows an RTH leg as RTH_ENROUTE", () => {
    useTelemetryStore.getState().setNavStatus(2, 2, 0);
    render(<NavStatePill />);
    expect(screen.getByRole("status").textContent).toBe("RTH_ENROUTE");
  });

  it("shows an auto landing waypoint with its LAND action", () => {
    useTelemetryStore.getState().setNavStatus(3, 9, 8);
    render(<NavStatePill />);
    expect(screen.getByRole("status").textContent).toBe("LAND_IN_PROGRESS/LAND");
  });

  it("hides a nav status that has stopped arriving", () => {
    useTelemetryStore.getState().setNavStatus(2, 2, 0);
    useTelemetryStore.setState({ navStatusUpdated: Date.now() - TELEMETRY_STALE_MS - 1 });
    const { container } = render(<NavStatePill />);
    expect(container.textContent).toBe("");
  });
});
