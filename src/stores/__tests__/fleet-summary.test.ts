import { describe, expect, it } from "vitest";
import { selectFleetSummary } from "../node-registry/fleet-summary";
import type { FleetDrone } from "@/lib/types";

const THRESHOLDS = { warningPct: 30, criticalPct: 15 };

function drone(over: Partial<FleetDrone>): FleetDrone {
  return {
    id: over.name ?? "d",
    name: "d",
    status: "online",
    connectionState: "connected",
    flightMode: "LOITER",
    armState: "disarmed",
    lastHeartbeat: 0,
    profile: "drone",
    fcAttached: true,
    fcLinkLost: false,
    ...over,
  };
}

const battery = (remaining: number, voltage: number): FleetDrone["battery"] => ({
  voltage,
  remaining,
  timestamp: 0,
});

describe("selectFleetSummary battery", () => {
  it("averages only current, known packs and names the lowest of them", () => {
    const summary = selectFleetSummary(
      [
        drone({ name: "a", battery: battery(80, 16) }),
        drone({ name: "b", battery: battery(20, 14) }),
        drone({ name: "unknown", battery: battery(-1, 15) }),
        drone({ name: "offline", status: "offline", battery: battery(5, 13) }),
        drone({ name: "silent", fcLinkLost: true, battery: battery(1, 12) }),
        drone({ name: "no-fc", fcAttached: false, battery: battery(2, 12) }),
      ],
      THRESHOLDS,
    );
    expect(summary.battery.reporting.map((r) => r.drone.name)).toEqual(["a", "b"]);
    expect(summary.battery.averagePct).toBe(50);
    expect(summary.battery.averageVoltage).toBe(15);
    expect(summary.battery.lowest?.drone.name).toBe("b");
    expect(summary.battery.lowCount).toBe(1);
  });

  it("reports no aggregate, not zero, when nothing is reporting", () => {
    const summary = selectFleetSummary(
      [drone({ battery: battery(-1, 0) }), drone({ status: "offline", battery: battery(50, 15) })],
      THRESHOLDS,
    );
    expect(summary.battery.averagePct).toBeNull();
    expect(summary.battery.averageVoltage).toBeNull();
    expect(summary.battery.lowest).toBeNull();
  });
});

describe("selectFleetSummary telemetry rows", () => {
  it("lists connected drones with an FC and counts GPS only from live readings", () => {
    const gps = { fixType: 3, satellites: 4, timestamp: 0 } as FleetDrone["gps"];
    const summary = selectFleetSummary(
      [
        drone({ name: "live", armState: "armed", gps }),
        drone({ name: "silent", fcLinkLost: true, gps }),
        drone({ name: "gone", connectionState: "disconnected", status: "offline", gps }),
        drone({ name: "ground", profile: "ground-station" }),
      ],
      THRESHOLDS,
    );
    expect(summary.telemetryRows.map((r) => r.drone.name)).toEqual(["live", "silent"]);
    expect(summary.armedCount).toBe(1);
    expect(summary.gps).toEqual({ reporting: 1, fix3d: 1, lowSats: 1 });
    expect(summary.linkLost.map((d) => d.name)).toEqual(["silent"]);
  });
});
