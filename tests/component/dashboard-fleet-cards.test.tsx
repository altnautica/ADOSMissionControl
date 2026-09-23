/**
 * Dashboard fleet cards summarise only current flight-controller readings: an
 * unknown pack (remaining -1) is not averaged or ranked, an offline or FC-less
 * row contributes nothing, and a row without a linked FC is not listed with
 * invented sats, voltage, mode or arm state.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

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

import { renderWithIntl } from "../helpers/intl-wrapper";
import { AvgBatteryCard } from "@/components/dashboard/AvgBatteryCard";
import { FleetTelemetryCard } from "@/components/dashboard/FleetTelemetryCard";
import { useFleetStore } from "@/stores/fleet-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { FleetDrone } from "@/lib/types";

function drone(over: Partial<FleetDrone>): FleetDrone {
  return {
    id: over.name ?? "d",
    name: "d",
    status: "online",
    connectionState: "connected",
    flightMode: "LOITER",
    armState: "disarmed",
    lastHeartbeat: Date.now(),
    profile: "drone",
    fcAttached: true,
    fcLinkLost: false,
    ...over,
  } as FleetDrone;
}

const battery = (remaining: number, voltage: number) =>
  ({ voltage, current: 5, remaining, timestamp: Date.now() }) as FleetDrone["battery"];

beforeEach(() => {
  useSettingsStore.setState({ batteryWarningPct: 30, batteryCriticalPct: 15 });
});
afterEach(() => {
  cleanup();
  useFleetStore.setState({ drones: [] });
});

describe("AvgBatteryCard", () => {
  it("leaves unknown, offline and FC-less packs out of the average and the minimum", () => {
    useFleetStore.setState({
      drones: [
        drone({ name: "Arducopter", battery: battery(12, 14.2) }),
        drone({ name: "Betaflight", battery: battery(-1, 16.4) }),
        drone({ name: "Gone", status: "offline", battery: battery(90, 16.8) }),
        drone({ name: "Silent", fcLinkLost: true, battery: battery(95, 16.8) }),
      ],
    });
    renderWithIntl(<AvgBatteryCard />);
    expect(screen.getByText("12%")).toBeTruthy();
    expect(screen.getByText("Lowest: Arducopter")).toBeTruthy();
    expect(screen.getByText("12% / 14.2V")).toBeTruthy();
    expect(screen.getByText("1 reporting")).toBeTruthy();
    expect(screen.getByText("1 low")).toBeTruthy();
    expect(screen.queryByText(/-1%/)).toBeNull();
  });

  it("shows a placeholder, not 0% / 0.0V, when nothing reports", () => {
    useFleetStore.setState({
      drones: [drone({ name: "Betaflight", battery: battery(-1, 16.4) })],
    });
    renderWithIntl(<AvgBatteryCard />);
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByText("0.0V")).toBeNull();
    expect(screen.getByText("No flight controller is reporting a battery")).toBeTruthy();
  });
});

describe("FleetTelemetryCard", () => {
  it("does not list nodes without a linked FC", () => {
    useFleetStore.setState({
      drones: [
        drone({ name: "Ground", profile: "ground-station", fcAttached: false, flightMode: "STABILIZE", armState: "unknown" }),
        drone({ name: "Companion", fcAttached: false, flightMode: "STABILIZE", armState: "unknown" }),
      ],
    });
    renderWithIntl(<FleetTelemetryCard />);
    expect(screen.queryByText("Ground")).toBeNull();
    expect(screen.queryByText("Companion")).toBeNull();
    expect(screen.queryByText("STABILIZE")).toBeNull();
    expect(screen.queryByText("0sat")).toBeNull();
  });

  it("renders missing FC fields as dashes, never 0sat / 0.0V / a default mode", () => {
    useFleetStore.setState({
      drones: [
        drone({ name: "Fresh", flightMode: "STABILIZE", armState: "unknown" }),
      ],
    });
    renderWithIntl(<FleetTelemetryCard />);
    expect(screen.getByText("Fresh")).toBeTruthy();
    expect(screen.queryByText("0sat")).toBeNull();
    expect(screen.queryByText("0.0V")).toBeNull();
    expect(screen.queryByText("STABILIZE")).toBeNull();
    expect(screen.queryByText("DIS")).toBeNull();
  });

  it("shows a heard FC's readings", () => {
    useFleetStore.setState({
      drones: [
        drone({
          name: "Heard",
          battery: battery(60, 15.1),
          gps: { fixType: 3, satellites: 14, lat: 0, lon: 0, alt: 0, hdop: 1 } as FleetDrone["gps"],
        }),
      ],
    });
    renderWithIntl(<FleetTelemetryCard />);
    expect(screen.getByText("14sat")).toBeTruthy();
    expect(screen.getByText("15.1V")).toBeTruthy();
    expect(screen.getByText("LOITER")).toBeTruthy();
    expect(screen.getByText("DIS")).toBeTruthy();
  });
});
