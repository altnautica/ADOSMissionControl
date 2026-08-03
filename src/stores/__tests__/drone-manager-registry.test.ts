/**
 * @license GPL-3.0-only
 *
 * Regression guard for the "direct FC connects but no dashboard card appears"
 * bug. A directly-connected flight controller (USB serial / WebSocket / BLE,
 * no companion agent) is registered ONLY in useDroneManager — which powers the
 * "Active Connections" list — but the dashboard fleet cards project from the
 * node registry (FleetProjectionBridge -> selectFleetDrones). The direct-FC
 * connect paths never called registry.attachFc, so the registry stayed empty
 * and the dashboard showed "No Drones Connected" while the connection was live.
 *
 * The fix centralizes the registry lifecycle in drone-manager: a drone that
 * owns its fleet row (ownsFleetRow defaults true for a direct FC) attaches to
 * the registry on addDrone and detaches on removeDrone. An agent-attached FC
 * (ownsFleetRow=false) is left to AgentMavlinkBridge, which owns its presence
 * row. These tests lock that contract through the public addDrone/removeDrone.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useDroneManager } from "../drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { selectFleetDrones } from "@/stores/node-registry/select-fleet-drones";
import { MockProtocol } from "@/mock/mock-protocol";
import type { Transport } from "@/lib/protocol/types";
import type { VehicleInfo } from "@/lib/protocol/types";

/** A minimal passive transport: addDrone only wires its close handler. */
function fakeTransport(): Transport {
  return {
    type: "websocket",
    connect: async () => {},
    disconnect: async () => {},
    send: () => {},
    on: () => {},
    off: () => {},
    isConnected: true,
    canCommand: true,
  };
}

/** Spin up a passive MockProtocol + its vehicle info for an addDrone call. */
async function makeDrone(): Promise<{
  protocol: MockProtocol;
  transport: Transport;
  vehicleInfo: VehicleInfo;
}> {
  const protocol = new MockProtocol();
  const transport = fakeTransport();
  const vehicleInfo = await protocol.connect(transport);
  return { protocol, transport, vehicleInfo };
}

/** The projected fleet rows from the current registry state. */
function projectedRows() {
  const nodes = useNodeRegistryStore.getState().nodes;
  return selectFleetDrones({ nodes, cloudStatuses: {}, now: Date.now() });
}

beforeEach(() => {
  useNodeRegistryStore.setState({ nodes: {}, lastUpdate: 0 });
  useDroneManager.getState().clear();
});

describe("drone-manager <-> node-registry lifecycle", () => {
  it("addDrone attaches a direct FC to the registry so it projects a fleet card", async () => {
    const { protocol, transport, vehicleInfo } = await makeDrone();

    useDroneManager
      .getState()
      .addDrone("fc-direct-1", "ArduCopter (copter)", protocol, transport, vehicleInfo, {
        type: "serial",
      });

    const entry = useNodeRegistryStore.getState().nodes["fc-direct-1"];
    expect(entry).toBeDefined();
    expect(entry.fc.managedId).toBe("fc-direct-1");

    const rows = projectedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("fc-direct-1");
    expect(rows[0].fcAttached).toBe(true);
  });

  it("removeDrone detaches the direct FC so the registry GCs the row and the card disappears", async () => {
    const { protocol, transport, vehicleInfo } = await makeDrone();
    const manager = useDroneManager.getState();

    manager.addDrone("fc-direct-2", "ArduCopter (copter)", protocol, transport, vehicleInfo, {
      type: "serial",
    });
    expect(useNodeRegistryStore.getState().nodes["fc-direct-2"]).toBeDefined();

    manager.removeDrone("fc-direct-2");

    expect(useNodeRegistryStore.getState().nodes["fc-direct-2"]).toBeUndefined();
    expect(projectedRows()).toHaveLength(0);
  });

  it("an agent-attached FC (ownsFleetRow=false) is NOT registered by drone-manager", async () => {
    const { protocol, transport, vehicleInfo } = await makeDrone();

    // AgentMavlinkBridge owns the presence row + its own attachFc for this path;
    // drone-manager must not write a registry row when it does not own it.
    useDroneManager
      .getState()
      .addDrone(
        "node:dev-agent",
        "Agent Drone",
        protocol,
        transport,
        vehicleInfo,
        { type: "websocket" },
        { ownsFleetRow: false },
      );

    expect(useNodeRegistryStore.getState().nodes["node:dev-agent"]).toBeUndefined();
  });
});
