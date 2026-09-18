/**
 * The reconnect state machine, which shipped with no test at all.
 *
 * It is what puts a dropped vehicle back on the link, so the properties that
 * matter are: it actually retries, it backs off rather than hammering, it
 * stops at the attempt cap instead of retrying forever, a success ends the
 * cycle, and a cancel is honoured mid-flight. Each of those is observable
 * through the state-change listener the surfaces already subscribe to.
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
}));

import {
  ReconnectManager,
  type ReconnectEntry,
} from "@/lib/reconnect-manager";
import type { ConnectionMeta } from "@/stores/drone-manager";

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

  it("backs off between attempts instead of hammering the port", async () => {
    const at: number[] = [];
    getKnownPorts.mockImplementation(async () => {
      at.push(Date.now());
      return [];
    });
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(at.length).toBeGreaterThanOrEqual(3);
    // Strictly increasing gaps until the ladder saturates: the first retry is
    // fast so a momentary USB re-enumeration recovers immediately, and later
    // ones are slow so a genuinely absent vehicle is not hammered.
    const firstGap = at[1] - at[0];
    const secondGap = at[2] - at[1];
    expect(secondGap).toBeGreaterThan(firstGap);
  });

  it("gives up at the attempt cap rather than retrying forever", async () => {
    const manager = new ReconnectManager(() => {});
    const states = recorder(manager);

    manager.startReconnect("d1", "Drone 1", SERIAL);
    // Far past the ladder's total: 5 escalating waits then 5 s each.
    await vi.advanceTimersByTimeAsync(300_000);

    expect(states.at(-1)).toBe("failed");
    expect(manager.isReconnecting()).toBe(false);
    const after = getKnownPorts.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(
      getKnownPorts.mock.calls.length,
      "no attempts after the terminal state",
    ).toBe(after);
  });

  it("stops attempting once cancelled mid-cycle", async () => {
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(1_200);
    const before = getKnownPorts.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    manager.cancelReconnect("d1");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getKnownPorts.mock.calls.length).toBe(before);
    expect(manager.isReconnecting()).toBe(false);
  });

  it("restarting a drone's cycle replaces the old one rather than racing it", async () => {
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(600);
    const afterFirst = getKnownPorts.mock.calls.length;

    manager.startReconnect("d1", "Drone 1", SERIAL);
    await vi.advanceTimersByTimeAsync(600);

    // One ladder, restarted — not two concurrent ladders fighting over the
    // same port. A second start cancels the first, so the attempt rate does
    // not double.
    const afterSecond = getKnownPorts.mock.calls.length - afterFirst;
    expect(afterSecond).toBeLessThanOrEqual(afterFirst + 1);
    expect(manager.isReconnecting()).toBe(true);
  });

  it("cancelAll clears every in-flight cycle", () => {
    const manager = new ReconnectManager(() => {});

    manager.startReconnect("d1", "Drone 1", SERIAL);
    manager.startReconnect("d2", "Drone 2", SERIAL);
    expect(manager.isReconnecting()).toBe(true);

    manager.cancelAll();
    expect(manager.isReconnecting()).toBe(false);
  });
});
