/**
 * @license GPL-3.0-only
 *
 * Fleet recall over the projected fleet: a drone on a live FC link is
 * commanded, and a drone whose FC link is lost is reported to the operator as
 * not recalled rather than skipped or waited on.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { describeFleetOutcome, returnFleetToLaunch } from "@/lib/fleet-commands";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import type { FleetDrone } from "@/lib/types";

function fleetDrone(over: Partial<FleetDrone> & { id: string }): FleetDrone {
  return {
    name: over.id,
    status: "online",
    connectionState: "connected",
    flightMode: "AUTO",
    armState: "unknown",
    lastHeartbeat: Date.now(),
    fcAttached: true,
    fcLinkLost: false,
    ...over,
  };
}

function managed(id: string, returnToLaunch: () => Promise<unknown>): [string, ManagedDrone] {
  return [id, { id, protocol: { returnToLaunch } } as unknown as ManagedDrone];
}

beforeEach(() => {
  useFleetStore.setState({ drones: [] });
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("returnFleetToLaunch", () => {
  it("recalls live armed drones and reports a link-lost drone as not recalled, without sending", async () => {
    const liveRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    const lostRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    useFleetStore.setState({
      drones: [
        fleetDrone({ id: "live", armState: "armed", connectionState: "armed", status: "in_mission" }),
        fleetDrone({ id: "lost", fcLinkLost: true }),
      ],
    });
    useDroneManager.setState({
      drones: new Map([managed("live", liveRtl), managed("lost", lostRtl)]),
    });

    const outcome = await returnFleetToLaunch();

    expect(liveRtl).toHaveBeenCalledTimes(1);
    expect(lostRtl).not.toHaveBeenCalled();
    expect(outcome.acknowledged).toEqual(["live"]);
    expect(outcome.attempted).toBe(2);
    expect(outcome.failures).toEqual(["lost: FC link lost, arm state unknown"]);
    expect(describeFleetOutcome(outcome, "RTH").variant).toBe("error");
  });

  it("with nothing armed and nothing lost, reports a warning rather than success", async () => {
    useFleetStore.setState({ drones: [fleetDrone({ id: "parked", armState: "disarmed" })] });
    const outcome = await returnFleetToLaunch();
    expect(outcome.attempted).toBe(0);
    expect(describeFleetOutcome(outcome, "RTH")).toEqual({
      message: "No active drones for RTH",
      variant: "warning",
    });
  });
});
