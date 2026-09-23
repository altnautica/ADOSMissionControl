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
 * The fix centralizes the registry lifecycle in drone-manager: every managed
 * session is keyed by its node id, so addDrone attaches the FC to the registry
 * (creating the row for a direct FC, joining the presence row for an agent or
 * relayed FC) and removeDrone detaches it. No bridge has to remember to. These
 * tests lock that contract through the public addDrone/removeDrone, plus the
 * link-loss path: a silent FC reads arm state "unknown" and link lost, never
 * disarmed and never a confident armed / in-mission.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useDroneManager } from "../drone-manager";
import { useDroneStore } from "../drone-store";
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

  it("a relayed FC session (ownsFleetRow=false) attaches onto its presence row and projects arm state", async () => {
    const { protocol, transport, vehicleInfo } = await makeDrone();
    const registry = useNodeRegistryStore.getState();
    registry.upsertPresence(
      "node:relayed-1",
      { deviceId: "relayed-1", name: "Relayed", lastHeartbeat: Date.now() },
      "relayed",
    );

    useDroneManager
      .getState()
      .addDrone(
        "node:relayed-1",
        "Relayed",
        protocol,
        transport,
        vehicleInfo,
        { type: "websocket", url: "ws://192.168.1.50:8765/" },
        { ownsFleetRow: false },
      );

    const entry = useNodeRegistryStore.getState().getEntry("node:relayed-1");
    expect(entry?.fc.managedId).toBe("node:relayed-1");
    expect(entry?.connection.fcConnected).toBe(true);
    expect(entry?.connection.transport).toBe("websocket");

    protocol.emitHeartbeat(true, "AUTO");
    const [row] = projectedRows();
    expect(row.fcAttached).toBe(true);
    expect(row.armState).toBe("armed");
    expect(row.connectionState).toBe("armed");
    expect(row.status).toBe("in_mission");
  });

  it("link loss makes the arm state unknown and the fleet row link lost, not disarmed", async () => {
    const { protocol, transport, vehicleInfo } = await makeDrone();
    let fireLinkLost: (() => void) | undefined;
    const subscribe = protocol.onLinkLost;
    protocol.onLinkLost = (cb) => {
      fireLinkLost = cb;
      return subscribe(cb);
    };
    useNodeRegistryStore
      .getState()
      .upsertPresence(
        "node:lost-1",
        { deviceId: "lost-1", name: "Lost", lastHeartbeat: Date.now() },
        "local",
      );
    const manager = useDroneManager.getState();
    manager.addDrone(
      "node:lost-1",
      "Lost",
      protocol,
      transport,
      vehicleInfo,
      { type: "websocket" },
      { ownsFleetRow: false },
    );
    // First managed drone: auto-selected, so the single-slot store follows it.
    expect(useDroneManager.getState().selectedDroneId).toBe("node:lost-1");
    protocol.emitHeartbeat(true, "AUTO");
    expect(projectedRows()[0].armState).toBe("armed");

    fireLinkLost?.();

    expect(useNodeRegistryStore.getState().getEntry("node:lost-1")?.fc.armState).toBe("unknown");
    expect(useDroneStore.getState().armState).toBe("unknown");
    const [row] = projectedRows();
    expect(row.fcLinkLost).toBe(true);
    expect(row.armState).toBe("unknown");
    expect(row.connectionState).not.toBe("armed");
    expect(row.status).not.toBe("in_mission");
  });

  it("removeDrone detaches an agent-attached FC and keeps the presence-owned row", async () => {
    const { protocol, transport, vehicleInfo } = await makeDrone();
    useNodeRegistryStore
      .getState()
      .upsertPresence(
        "node:dev-agent",
        { deviceId: "dev-agent", name: "Agent Drone", lastHeartbeat: Date.now() },
        "local",
      );
    const manager = useDroneManager.getState();
    manager.addDrone(
      "node:dev-agent",
      "Agent Drone",
      protocol,
      transport,
      vehicleInfo,
      { type: "websocket" },
      { ownsFleetRow: false },
    );
    protocol.emitHeartbeat(true, "AUTO");

    manager.removeDrone("node:dev-agent");

    const entry = useNodeRegistryStore.getState().getEntry("node:dev-agent");
    expect(entry).toBeDefined();
    expect(entry?.fc.managedId).toBeNull();
    expect(entry?.fc.armState).toBeUndefined();
    expect(entry?.connection.fcConnected).toBe(false);
    const [row] = projectedRows();
    expect(row.fcAttached).toBe(false);
    expect(row.armState).toBe("unknown");
    expect(row.status).toBe("online");
  });
});
