import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { enterSlcanMode, matchReenumeratedPort } from "@/lib/protocol/transport/slcan-flash-arbiter";
import { useSlcanModeStore } from "@/stores/slcan-mode-store";
import type { DroneProtocol } from "@/lib/protocol/types";

// ── Mocks for the WebSerial + SLCAN transports ─────────────────────

const mockSlcanOpen = vi.fn(async (_opts: { bitrate: number }) => undefined);
const mockSlcanClose = vi.fn(async () => undefined);
const mockByteConnect = vi.fn(async (_port: unknown) => undefined);

let openShouldThrow: Error | null = null;

vi.mock("@/lib/protocol/transport/slcan", () => {
  return {
    SlcanTransport: class {
      constructor(_byte: unknown, _owns: boolean) {
        void _byte;
        void _owns;
      }
      async open(opts: { bitrate: number }) {
        if (openShouldThrow) {
          const e = openShouldThrow;
          openShouldThrow = null;
          throw e;
        }
        return mockSlcanOpen(opts);
      }
      async close() {
        return mockSlcanClose();
      }
      getState() {
        return "open" as const;
      }
      getStats() {
        return { txCount: 0, rxCount: 0, txErrors: 0, rxErrors: 0 };
      }
      send() {
        return Promise.resolve();
      }
      onFrame() {
        return () => {};
      }
      onState() {
        return () => {};
      }
    },
  };
});

vi.mock("@/lib/protocol/transport/webserial", () => {
  return {
    WebSerialTransport: class {
      readonly type = "webserial" as const;
      isConnected = false;
      async connectToPort(port: unknown, _baud: number) {
        void _baud;
        await mockByteConnect(port);
        this.isConnected = true;
      }
      async disconnect() {
        this.isConnected = false;
      }
      getPort() {
        return null;
      }
      on() {}
      off() {}
      send() {}
    },
  };
});

// ── Serial ports ────────────────────────────────────────────────────

function makePort(usbVendorId?: number, usbProductId?: number): SerialPort {
  return { getInfo: () => ({ usbVendorId, usbProductId }) } as unknown as SerialPort;
}

const fcPort = makePort(0x1209, 0x5741);

function installSerialStub(ports: () => SerialPort[]) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      ...((globalThis as { navigator?: unknown }).navigator ?? {}),
      serial: {
        getPorts: async () => ports(),
        requestPort: async () => fcPort,
      },
    },
  });
}

// ── Fake DroneProtocol ─────────────────────────────────────────────

function makeFakeProtocol(opts: { currentCport?: number } = {}) {
  const ok = { success: true, resultCode: 0, message: "ok" };
  const calls: string[] = [];
  const setParam = vi.fn(async (name: string, value?: number) => {
    calls.push(`set ${name}=${value}`);
    return ok;
  });
  const getParam = vi.fn(async (name: string) => ({
    name, value: opts.currentCport ?? 0, type: 9, index: 0, count: 1,
  }));
  const reboot = vi.fn(async () => { calls.push("reboot"); return ok; });
  const enableCanForward = vi.fn(async (_bus: number) => ok);
  const commit = vi.fn(async () => { calls.push("commit"); return ok; });
  const disconnect = vi.fn(async () => { calls.push("disconnect"); });
  const connect = vi.fn(async () => { calls.push("connect"); return {}; });
  const transport = { type: "webserial" as const, getPort: () => fcPort };

  const protocol = {
    isConnected: true,
    protocolName: "mavlink",
    transport,
    setParameter: setParam,
    getParameter: getParam,
    commitParamsToFlash: commit,
    reboot,
    enableCanForward,
    disconnect,
    connect,
    getVehicleInfo: () => ({ boardId: 1013 }),
    getCapabilities: () => ({}),
    getFirmwareHandler: () => null,
  } as unknown as DroneProtocol;

  return { protocol, calls, setParam, reboot, enableCanForward, commit, disconnect, connect };
}

beforeEach(() => {
  useSlcanModeStore.getState().reset();
  mockSlcanOpen.mockClear();
  mockSlcanClose.mockClear();
  mockByteConnect.mockClear();
  openShouldThrow = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installSerialStub(() => [fcPort]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enterSlcanMode", () => {
  it("applies a changed CPORT with a reboot and writes SERNUM last, after MAVLink is back", async () => {
    const { protocol, calls, enableCanForward } = makeFakeProtocol({ currentCport: 0 });
    const promise = enterSlcanMode({ protocol, droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 120 });
    await vi.advanceTimersByTimeAsync(10_000);
    const session = await promise;

    expect(session.slcanTransport).toBeTruthy();
    expect(calls.indexOf("set CAN_SLCAN_CPORT=1")).toBeLessThan(calls.indexOf("set CAN_SLCAN_TIMOUT=120"));
    expect(calls.indexOf("set CAN_SLCAN_TIMOUT=120")).toBeLessThan(calls.indexOf("reboot"));
    expect(calls.indexOf("reboot")).toBeLessThan(calls.indexOf("connect"));
    expect(calls.indexOf("connect")).toBeLessThan(calls.indexOf("set CAN_SLCAN_SERNUM=0"));
    expect(enableCanForward).not.toHaveBeenCalled();
    expect(useSlcanModeStore.getState().state).toBe("SLCAN_ACTIVE");
  });

  it("skips the reboot when CPORT already routes the requested bus", async () => {
    const { protocol, calls, reboot } = makeFakeProtocol({ currentCport: 2 });
    const promise = enterSlcanMode({ protocol, droneId: "d", bus: 2, bitrate: 500_000, timeoutSec: 30 });
    await vi.advanceTimersByTimeAsync(3_000);
    await promise;

    expect(reboot).not.toHaveBeenCalled();
    expect(calls.at(-2)).toBe("set CAN_SLCAN_SERNUM=0");
    expect(useSlcanModeStore.getState().state).toBe("SLCAN_ACTIVE");
  });

  it("an SLCAN handshake failure rolls back CPORT and marks ERROR", async () => {
    const { protocol, setParam } = makeFakeProtocol({ currentCport: 1 });
    openShouldThrow = new Error("SLCAN adapter returned BEL");
    const promise = enterSlcanMode({ protocol, droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 120 });
    const rejection = expect(promise).rejects.toThrow(/SLCAN handshake failed/);
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;

    expect(useSlcanModeStore.getState().state).toBe("ERROR");
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_CPORT", 0);
  });

  it("throws when transport is not WebSerial-compatible", async () => {
    const { protocol } = makeFakeProtocol();
    (protocol as unknown as { transport: { type: string } }).transport = { type: "websocket" };
    await expect(
      enterSlcanMode({ protocol, droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 120 }),
    ).rejects.toThrow(/SLCAN requires direct USB/);
  });

  it("a param write the FC refuses aborts the entry before any reboot or port switch", async () => {
    const { protocol, setParam, reboot } = makeFakeProtocol();
    setParam.mockImplementation(async (name: string) =>
      name === "CAN_SLCAN_TIMOUT"
        ? { success: false, resultCode: 1, message: "value out of range" }
        : { success: true, resultCode: 0, message: "ok" },
    );
    await expect(
      enterSlcanMode({ protocol, droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 120 }),
    ).rejects.toThrow(/CAN_SLCAN_TIMOUT/);
    expect(reboot).not.toHaveBeenCalled();
    expect(setParam).not.toHaveBeenCalledWith("CAN_SLCAN_SERNUM", expect.anything());
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_CPORT", 0);
    expect(useSlcanModeStore.getState().state).toBe("ERROR");
  });

  it("refuses a timeout CAN_SLCAN_TIMOUT cannot hold, including 0 (never revert)", async () => {
    const { protocol, setParam } = makeFakeProtocol();
    for (const timeoutSec of [300, 0]) {
      await expect(
        enterSlcanMode({ protocol, droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec }),
      ).rejects.toThrow(/1\.\.127/);
    }
    expect(setParam).not.toHaveBeenCalled();
  });
});

describe("SLCAN exit", () => {
  it("retries MAVLink until the FC's SLCAN timeout hands the port back, then clears CPORT", async () => {
    const { protocol, connect, setParam, commit } = makeFakeProtocol({ currentCport: 1 });
    const promise = enterSlcanMode({ protocol, droneId: "d", bus: 1, bitrate: 1_000_000, timeoutSec: 5 });
    await vi.advanceTimersByTimeAsync(3_000);
    const session = await promise;
    setParam.mockClear();
    commit.mockClear();

    // The FC is still in SLCAN for the first two attempts.
    connect
      .mockRejectedValueOnce(new Error("No heartbeat received within 10 seconds"))
      .mockRejectedValueOnce(new Error("No heartbeat received within 10 seconds"));
    const exit = session.exitFn();
    await vi.advanceTimersByTimeAsync(5_000);
    await exit;

    expect(connect).toHaveBeenCalledTimes(3);
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_CPORT", 0);
    expect(commit).toHaveBeenCalled();
    expect(useSlcanModeStore.getState().state).toBe("IDLE");
  });
});

describe("matchReenumeratedPort", () => {
  const info = fcPort.getInfo();

  it("finds the FC by USB id, not by its position in the granted list", () => {
    const radio = makePort(0x0403, 0x6015);
    const reenumerated = makePort(0x1209, 0x5741);
    expect(matchReenumeratedPort(fcPort, info, [radio, reenumerated])).toBe(reenumerated);
  });

  it("prefers the same port object when it is still present", () => {
    const twin = makePort(0x1209, 0x5741);
    expect(matchReenumeratedPort(fcPort, info, [twin, fcPort])).toBe(fcPort);
  });

  it("returns null while the FC has not come back", () => {
    expect(matchReenumeratedPort(fcPort, info, [makePort(0x0403, 0x6015)])).toBeNull();
  });

  it("refuses to guess between two matching devices", () => {
    expect(() =>
      matchReenumeratedPort(fcPort, info, [makePort(0x1209, 0x5741), makePort(0x1209, 0x5741)]),
    ).toThrow(/More than one/);
  });
});
