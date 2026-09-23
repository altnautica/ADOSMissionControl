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

  it("sends to every drone at once and reports a partial failure per drone", async () => {
    // The first drone never answers until released; a sequential fan-out would
    // not reach the other two until it settled.
    const hung = Promise.withResolvers<never>();
    const slowRtl = vi.fn(() => hung.promise);
    const okRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    const deniedRtl = vi.fn(async () => ({ success: false, resultCode: 4, message: "denied" }));
    const armed = { armState: "armed", connectionState: "armed", status: "in_mission" } as const;
    useFleetStore.setState({
      drones: [
        fleetDrone({ id: "a-silent", ...armed }),
        fleetDrone({ id: "b-ok", ...armed }),
        fleetDrone({ id: "c-denied", ...armed }),
        fleetDrone({ id: "d-nolink", ...armed }),
      ],
    });
    useDroneManager.setState({
      drones: new Map([
        managed("a-silent", slowRtl),
        managed("b-ok", okRtl),
        managed("c-denied", deniedRtl),
      ]),
    });

    const pending = returnFleetToLaunch();
    await Promise.resolve();
    expect(okRtl).toHaveBeenCalledTimes(1);
    expect(deniedRtl).toHaveBeenCalledTimes(1);

    hung.reject(new Error("timeout"));
    const outcome = await pending;
    expect(outcome.attempted).toBe(4);
    expect(outcome.acknowledged).toEqual(["b-ok"]);
    expect(outcome.failures).toEqual([
      "a-silent: timeout",
      "c-denied: denied",
      "d-nolink: no command link",
    ]);
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
