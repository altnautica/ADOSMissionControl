import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { enterSlcanMode } from "@/lib/protocol/transport/slcan-flash-arbiter";
import { useSlcanModeStore } from "@/stores/slcan-mode-store";
import type { DroneProtocol } from "@/lib/protocol/types";

// ── Mocks for the WebSerial + SLCAN transports ─────────────────────

const mockSlcanOpen = vi.fn(async (_opts: { bitrate: number }) => undefined);
const mockSlcanClose = vi.fn(async () => undefined);
const mockByteConnect = vi.fn(async () => undefined);

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
      // The OTA orchestrator never sees this mock in unit tests; surface a
      // minimal CanTransport shape so the type assertions inside the
      // arbiter compile.
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
      async connectToPort(_port: unknown, _baud: number) {
        void _port;
        void _baud;
        await mockByteConnect();
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

// ── Stub navigator.serial.getPorts() so the F4 poll resolves ───────

const fakePort = {} as unknown as SerialPort;

function installSerialStub(ports: SerialPort[] = [fakePort]) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      ...((globalThis as { navigator?: unknown }).navigator ?? {}),
      serial: {
        getPorts: async () => ports,
        requestPort: async () => fakePort,
      },
    },
  });
}

// ── Fake DroneProtocol ─────────────────────────────────────────────

interface FakeProtocolOpts {
  boardId: number;
  enableCanForwardResultOk?: boolean;
}

function makeFakeProtocol(opts: FakeProtocolOpts) {
  const setParam = vi.fn(async () => ({ success: true, resultCode: 0, message: "ok" }));
  const reboot = vi.fn(async () => ({ success: true, resultCode: 0, message: "ok" }));
  const enableCanForward = vi.fn(async (_bus: number) => ({
    success: opts.enableCanForwardResultOk ?? true,
    resultCode: 0,
    message: "ok",
  }));
  const commit = vi.fn(async () => ({ success: true, resultCode: 0, message: "ok" }));
  const disconnect = vi.fn(async () => undefined);
  const connect = vi.fn(async () => ({}));
  // The arbiter reads `protocol.transport` and pulls a port handle from
  // it; expose `getPort()` so `getSerialPort` returns a non-null port and
  // the arbiter doesn't throw "SLCAN requires direct USB".
  const transport = {
    type: "webserial" as const,
    getPort: () => fakePort,
  };

  const protocol = {
    isConnected: true,
    protocolName: "mavlink",
    transport,
    setParameter: setParam,
    commitParamsToFlash: commit,
    reboot,
    enableCanForward,
    disconnect,
    connect,
    getVehicleInfo: () => ({
      firmwareType: 0,
      vehicleClass: "copter",
      firmwareVersionString: "test",
      systemId: 1,
      componentId: 1,
      autopilotType: 3,
      vehicleType: 2,
      boardId: opts.boardId,
    }),
    getCapabilities: () => ({}),
    getFirmwareHandler: () => null,
  } as unknown as DroneProtocol;

  return {
    protocol,
    setParam,
    reboot,
    enableCanForward,
    commit,
    disconnect,
  };
}

beforeEach(() => {
  useSlcanModeStore.getState().reset();
  mockSlcanOpen.mockClear();
  mockSlcanClose.mockClear();
  mockByteConnect.mockClear();
  openShouldThrow = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installSerialStub([fakePort]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enterSlcanMode — happy paths", () => {
  it("F4 path: writes params, reboots, waits for port, opens SLCAN", async () => {
    const { protocol, setParam, reboot } = makeFakeProtocol({ boardId: 1031 }); // F4
    const promise = enterSlcanMode({
      protocol,
      droneId: "drone-1",
      bus: 1,
      bitrate: 1_000_000,
      timeoutSec: 300,
    });
    // Drive the internal delays.
    await vi.advanceTimersByTimeAsync(2_000);
    const session = await promise;

    expect(session.slcanTransport).toBeTruthy();
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_CPORT", 1);
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_SERNUM", 0);
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_TIMOUT", 300);
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_OVRIDE", 1);
    expect(reboot).toHaveBeenCalled();
    expect(useSlcanModeStore.getState().state).toBe("SLCAN_ACTIVE");
  });

  it("F7 hot-switch path: sends MAV_CMD_CAN_FORWARD, no reboot", async () => {
    const { protocol, reboot, enableCanForward } = makeFakeProtocol({
      boardId: 50, // Pixhawk 4 → F7
    });
    const promise = enterSlcanMode({
      protocol,
      droneId: "d",
      bus: 1,
      bitrate: 1_000_000,
      timeoutSec: 300,
    });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(enableCanForward).toHaveBeenCalledWith(1);
    expect(reboot).not.toHaveBeenCalled();
    expect(useSlcanModeStore.getState().state).toBe("SLCAN_ACTIVE");
  });

  it("H7 hot-switch path: same as F7", async () => {
    const { protocol, enableCanForward, reboot } = makeFakeProtocol({
      boardId: 1013, // MatekH743 → H7
    });
    const promise = enterSlcanMode({
      protocol,
      droneId: "d",
      bus: 2,
      bitrate: 500_000,
      timeoutSec: 120,
    });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(enableCanForward).toHaveBeenCalledWith(2);
    expect(reboot).not.toHaveBeenCalled();
  });
});

describe("enterSlcanMode — failure paths", () => {
  it("BEL on SLCAN open triggers rollback (sets CPORT=0, marks ERROR)", async () => {
    const { protocol, setParam } = makeFakeProtocol({ boardId: 50 }); // F7 path
    openShouldThrow = new Error("SLCAN adapter returned BEL");

    const promise = enterSlcanMode({
      protocol,
      droneId: "d",
      bus: 1,
      bitrate: 1_000_000,
      timeoutSec: 300,
    });
    // Attach a rejection handler before advancing timers so the
    // rollback rejection never goes unhandled.
    const rejection = expect(promise).rejects.toThrow(/SLCAN handshake failed/);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;

    expect(useSlcanModeStore.getState().state).toBe("ERROR");
    expect(setParam).toHaveBeenCalledWith("CAN_SLCAN_CPORT", 0);
  });

  it("enableCanForward rejected by FC triggers rollback", async () => {
    const { protocol } = makeFakeProtocol({
      boardId: 50,
      enableCanForwardResultOk: false,
    });
    const promise = enterSlcanMode({
      protocol,
      droneId: "d",
      bus: 1,
      bitrate: 1_000_000,
      timeoutSec: 300,
    });
    const rejection = expect(promise).rejects.toThrow(/enableCanForward rejected/);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(useSlcanModeStore.getState().state).toBe("ERROR");
  });

  it("throws when transport is not WebSerial-compatible", async () => {
    const { protocol } = makeFakeProtocol({ boardId: 50 });
    // Replace the transport with one that does NOT expose getPort.
    (protocol as unknown as { transport: { type: string } }).transport = {
      type: "websocket",
    };
    await expect(
      enterSlcanMode({
        protocol,
        droneId: "d",
        bus: 1,
        bitrate: 1_000_000,
        timeoutSec: 300,
      }),
    ).rejects.toThrow(/SLCAN requires direct USB/);
  });
});
