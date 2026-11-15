/**
 * @license GPL-3.0-only
 *
 * Fleet recall over the projected fleet: a drone on a live FC link is
 * commanded, and a drone whose FC link is lost is reported to the operator as
 * not recalled rather than skipped or waited on. A drone flown by its ADOS
 * pilot gets the pilot's return, and a drone with an agent on the LAN gets the
 * agent's `rtl`, never the flight controller's own RTL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type * as AgentSystem from "@/lib/agent/agent-client/system";
import { describeFleetOutcome, returnFleetToLaunch } from "@/lib/fleet-commands";
import { setFixtureFleet } from "../../../tests/helpers/fleet-drones";

vi.mock("@/stores/node-registry/use-fleet-drones", async (importOriginal) =>
  (await import("../../../tests/helpers/fleet-drones")).fleetDronesModuleMock(await importOriginal()),
);
const { lanAgents, runCommandMock } = vi.hoisted(() => ({
  lanAgents: {} as Record<string, { agentUrl: string; apiKey: string }>,
  runCommandMock: vi.fn(async () => ({ accepted: true, resultCode: 0, message: "Accepted" })),
}));
vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: (deviceId: string) => lanAgents[deviceId] ?? null,
}));
vi.mock("@/lib/agent/agent-client/system", async (importOriginal) => ({
  ...(await importOriginal<typeof AgentSystem>()),
  runCommand: runCommandMock,
}));
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { handlePilotServerFrame, setPilotSender, type PilotOutboundFrame } from "@/lib/input/pilot-stream";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { FleetDrone } from "@/lib/types";

afterEach(() => {
  setPilotSender(null);
  for (const k of Object.keys(lanAgents)) delete lanAgents[k];
  runCommandMock.mockClear();
  useNavStreamStore.getState().clear("flown");
});

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
  setFixtureFleet({ drones: [] });
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("returnFleetToLaunch", () => {
  it("recalls live armed drones and reports a link-lost drone as not recalled, without sending", async () => {
    const liveRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    const lostRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    setFixtureFleet({
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
    setFixtureFleet({
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
    setFixtureFleet({ drones: [fleetDrone({ id: "parked", armState: "disarmed" })] });
    const outcome = await returnFleetToLaunch();
    expect(outcome.attempted).toBe(0);
    expect(describeFleetOutcome(outcome, "RTH")).toEqual({
      message: "No active drones for RTH",
      variant: "warning",
    });
  });
});

describe("the fleet recall's route per drone", () => {
  const armed = { armState: "armed", connectionState: "armed", status: "in_mission" } as const;

  it("a drone flown by its ADOS pilot gets the pilot's return, not the FC's RTL", async () => {
    const fcRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    setFixtureFleet({ drones: [fleetDrone({ id: "flown", ...armed })] });
    useDroneManager.setState({ drones: new Map([managed("flown", fcRtl)]) });
    const sent: PilotOutboundFrame[] = [];
    setPilotSender((f) => {
      sent.push(f);
      if (f.op === "action") {
        queueMicrotask(() =>
          handlePilotServerFrame("flown", { kind: "action_result", name: f.name, id: f.id, ok: true }),
        );
      }
      return true;
    }, "flown");
    const wire = demoPilotWire({ control_mode: "ados", owner: "pilot", armed: true, landed: false });
    handlePilotServerFrame("flown", { kind: "pilot", data: wire });
    useNavStreamStore.getState().setPilot("flown", parsePilotState(wire)!);

    const outcome = await returnFleetToLaunch();

    expect(fcRtl).not.toHaveBeenCalled();
    expect(sent.filter((f) => f.op === "action").map((f) => (f.op === "action" ? f.name : null))).toEqual(["rth"]);
    expect(outcome.acknowledged).toEqual(["flown"]);
  });

  it("a drone with an agent on the LAN gets the agent's rtl, not the FC's RTL", async () => {
    const fcRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    lanAgents["agent-1"] = { agentUrl: "http://192.168.1.50:8080", apiKey: "k" };
    setFixtureFleet({ drones: [fleetDrone({ id: "node:agent-1", ...armed })] });
    useDroneManager.setState({ drones: new Map([managed("node:agent-1", fcRtl)]) });

    const outcome = await returnFleetToLaunch();

    expect(fcRtl).not.toHaveBeenCalled();
    expect(runCommandMock).toHaveBeenCalledWith(
      { baseUrl: "http://192.168.1.50:8080", apiKey: "k", relay: false },
      "rtl",
      [],
    );
    expect(outcome.acknowledged).toEqual(["node:agent-1"]);
  });

  it("a drone seen only through a ground station's relay gets its agent's rtl over the relay", async () => {
    const fcRtl = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    lanAgents["ground-7"] = { agentUrl: "http://192.168.1.60:8080", apiKey: "gs" };
    setFixtureFleet({ drones: [fleetDrone({ id: "node:drone-9", reachedVia: "node:ground-7", ...armed })] });
    useDroneManager.setState({ drones: new Map([managed("node:drone-9", fcRtl)]) });

    const outcome = await returnFleetToLaunch();

    expect(fcRtl).not.toHaveBeenCalled();
    expect(runCommandMock).toHaveBeenCalledWith(
      { baseUrl: "http://192.168.1.60:8080/api/v1/ground-station/relay-proxy/drone-9", apiKey: "gs", relay: true },
      "rtl",
      [],
    );
    expect(outcome.acknowledged).toEqual(["node:drone-9"]);
  });
});
