/**
 * The reconnect state machine for directly connected FCs.
 *
 * It is what puts a dropped vehicle back on the link, so the properties that
 * matter are: it retries at a fixed pace forever (a vehicle out of range for a
 * minute must still come back), a success ends the cycle, a cancel is honoured
 * even for an attempt already in flight, and an agent-attached FC is left to
 * its agent bridge. Each is observable through the state-change listener or the
 * add-drone callback.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The reconnect ladder is driven by the TRANSPORT attempt, not by the
// add-drone callback, so the port manager is the seam a test has to control.
// Everything below the seam (WebSerial, the FC adapter handshake) is real
// hardware and not what these tests are about.
const { getKnownPorts } = vi.hoisted(() => ({
  getKnownPorts: vi.fn<() => Promise<Array<{ port: unknown }>>>(),
}));

vi.mock("@/lib/serial-port-manager", () => ({
  serialPortManager: { getKnownPorts },
  matchKnownPort: (ports: Array<{ port: unknown }>) =>
    ports.length === 1 ? ports[0] : null,
}));

// Below the port seam: a transport that opens, and an FC handshake that answers
// as whichever vehicle a test puts on the link.
const { handshakeAnswer } = vi.hoisted(() => ({
  handshakeAnswer: {
    vehicle: {
      systemId: 1,
      firmwareType: "ardupilot-copter",
      vehicleType: 2,
      componentId: 1,
      autopilotType: 3,
      vehicleClass: "copter",
      firmwareVersionString: "4.5.0",
    } as Record<string, unknown>,
  },
}));
vi.mock("@/lib/protocol/transport/webserial", () => ({
  WebSerialTransport: class {
    async connectToPort() {}
    async disconnect() {}
  },
}));
vi.mock("@/lib/protocol/select-fc-adapter", () => ({
  createFcAdapter: async () => ({
    connect: async () => handshakeAnswer.vehicle,
    disconnect: async () => {},
  }),
}));

import {
  ReconnectManager,
  type ReconnectEntry,
} from "@/lib/reconnect-manager";
import type { ConnectionMeta } from "@/lib/connection-meta";

const SERIAL: ConnectionMeta = { type: "serial", baudRate: 57600 };

/** Record every state the manager announces, in order. */
function recorder(manager: ReconnectManager) {
  const states: string[] = [];
  manager.onStateChange((e: ReconnectEntry) => states.push(e.state));
  return states;
}

describe("ReconnectManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // No ports present -> `attemptSerial` throws immediately, which is the
    // failure path the ladder is built around.
    getKnownPorts.mockReset();
    getKnownPorts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps retrying while the port stays absent", async () => {
    const manager = new ReconnectManager(() => {});
    const states = recorder(manager);

    manager.startReconnect("d1", "Drone 1", SERIAL);
    expect(states[0]).toBe("waiting");

    await vi.advanceTimersByTimeAsync(10_000);

    // Several attempts, each announced, and still trying.
    expect(getKnownPorts.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(states).toContain("attempting");
    expect(manager.isReconnecting()).toBe(true);
  });

  it("retries at a fixed interval, never backing off", async () => {
    const at: number[] = [];
    getKnownPorts.mockImplementation(async () => {
      at.push(Date.now());
      return [];
    });
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(12_500);

    expect(at.length).toBe(4);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(gaps).toEqual([3_000, 3_000, 3_000]);
  });

  it("never gives up: still retrying after an hour, with no failed state", async () => {
    const manager = new ReconnectManager(() => {});
    const states = recorder(manager);

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(getKnownPorts.mock.calls.length).toBe(1200);
    expect(states).not.toContain("failed");
    expect(manager.isReconnecting()).toBe(true);
  });

  it("stops attempting once cancelled mid-cycle", async () => {
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(3_200);
    const before = getKnownPorts.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    manager.cancelReconnect("d1");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getKnownPorts.mock.calls.length).toBe(before);
    expect(manager.isReconnecting()).toBe(false);
  });

  it("discards a dial that lands after its cycle was cancelled", async () => {
    const ports = Promise.withResolvers<Array<{ port: unknown }>>();
    getKnownPorts.mockImplementation(() => ports.promise);
    const addDrone = vi.fn();
    const manager = new ReconnectManager(addDrone);

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getKnownPorts).toHaveBeenCalledTimes(1);

    manager.cancelReconnect("d1");
    // The in-flight attempt fails after the cancel; nothing may be rescheduled.
    ports.resolve([]);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getKnownPorts).toHaveBeenCalledTimes(1);
    expect(addDrone).not.toHaveBeenCalled();
  });

  it("restarting a drone's cycle replaces the old one rather than racing it", async () => {
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(3_100);
    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(6_000);

    // One cycle, restarted: 1 attempt before the restart, 2 after it.
    expect(getKnownPorts.mock.calls.length).toBe(3);
    expect(manager.isReconnecting()).toBe(true);
  });

  it("leaves an agent-attached FC and a relay session to their own bridge", async () => {
    const manager = new ReconnectManager(() => {});
    const states = recorder(manager);

    expect(
      manager.startReconnect("node:dev-1", "Agent FC", { type: "websocket", url: "ws://192.168.1.50:8765/" }),
    ).toBe(false);
    expect(manager.startReconnect("fc:relay", "Relay", { type: "mqtt-mavlink" })).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(states).toEqual([]);
    expect(manager.isReconnecting()).toBe(false);
  });

  it("cancelAll clears every in-flight cycle", () => {
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    manager.startReconnect("d2", "Drone 2", SERIAL);
    expect(manager.isReconnecting()).toBe(true);

    manager.cancelAll();
    expect(manager.isReconnecting()).toBe(false);
  });

  it("refuses a re-dialled link that answers as a different vehicle", async () => {
    getKnownPorts.mockResolvedValue([{ port: {} }]);
    const addDrone = vi.fn();
    const manager = new ReconnectManager(addDrone);
    const meta: ConnectionMeta = {
      ...SERIAL,
      vehicle: { systemId: 7, firmwareType: "ardupilot-copter", vehicleType: 2 },
    };

    manager.startReconnect("d1", "Drone 1", meta);
    await vi.advanceTimersByTimeAsync(10_000);

    // Sysid 1 answered, not the original sysid 7: never attached, still looking.
    expect(addDrone).not.toHaveBeenCalled();
    expect(manager.isReconnecting()).toBe(true);

    handshakeAnswer.vehicle = { ...handshakeAnswer.vehicle, systemId: 7 };
    await vi.advanceTimersByTimeAsync(3_000);
    expect(addDrone).toHaveBeenCalledOnce();
    expect(addDrone.mock.calls[0][0]).toBe("d1");
  });
});
