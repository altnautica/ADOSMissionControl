/**
 * Drone assignment labels: a drone with no FC battery reading shows "—", never a
 * made-up 0%, and a reading that stopped updating is marked stale.
 * @license GPL-3.0-only
 */
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { MissionEditor } from "@/components/planner/MissionEditor";
import type { FleetDrone } from "@/lib/types";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const noop = () => {};

function drone(extra: Partial<FleetDrone>): FleetDrone {
  return {
    id: "d1", name: "Alpha", status: "online", connectionState: "connected",
    flightMode: "STABILIZE", armState: "disarmed", lastHeartbeat: Date.now(),
    ...extra,
  } as FleetDrone;
}

function renderFor(d: FleetDrone) {
  renderWithIntl(
    <MissionEditor drones={[d]} missionName="" selectedDroneId={d.id}
      onNameChange={noop} onDroneChange={noop} />,
  );
}

afterEach(cleanup);

describe("MissionEditor drone battery label", () => {
  it("shows a dash when no battery has been received", () => {
    renderFor(drone({}));
    expect(screen.getByText("Alpha (—)")).toBeInTheDocument();
  });

  it("shows a dash for an agent-only node even if a battery object is present", () => {
    renderFor(drone({ fcAttached: false, battery: { timestamp: Date.now(), voltage: 0, remaining: 0 } }));
    expect(screen.getByText("Alpha (—)")).toBeInTheDocument();
  });

  it("shows a fresh reading as a plain percentage", () => {
    renderFor(drone({ fcAttached: true, battery: { timestamp: Date.now(), voltage: 16, remaining: 72.4 } }));
    expect(screen.getByText("Alpha (72%)")).toBeInTheDocument();
  });

  it("marks a reading that stopped updating as stale", () => {
    renderFor(drone({ fcAttached: true, battery: { timestamp: Date.now() - 60_000, voltage: 16, remaining: 72 } }));
    expect(screen.getByText("Alpha (72%, stale)")).toBeInTheDocument();
  });
});
