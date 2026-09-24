import { describe, it, expect, vi } from "vitest";

import { MavlinkCanForwardTransport } from "@/lib/protocol/transport/can-transport";
import type { CanFrame } from "@/lib/protocol/transport/can-transport";
import type { DroneProtocol } from "@/lib/protocol/types/protocol";
import type { CanFrameCallback, CanFdFrameCallback } from "@/lib/protocol/types/callbacks";

/**
 * Minimal protocol stub exposing only the surface the transport touches.
 * Each subscribe method stashes the callback so the test can synthesize
 * inbound frames; send methods record their args so we can assert encoding.
 */
function makeStubProtocol() {
  let canFrameCb: CanFrameCallback | null = null;
  let canFdFrameCb: CanFdFrameCallback | null = null;

  const stub = {
    enableCanForward: vi.fn(async (_bus: number) => ({
      success: true,
      resultCode: 0,
      message: "OK",
    })),
    sendCanFrame: vi.fn(
      (_bus: number, _id: number, _data: Uint8Array) => undefined,
    ),
    sendCanFdFrame: vi.fn(
      (_bus: number, _id: number, _data: Uint8Array) => undefined,
    ),
    onCanFrame: (cb: CanFrameCallback) => {
      canFrameCb = cb;
      return () => {
        canFrameCb = null;
      };
    },
    onCanFdFrame: (cb: CanFdFrameCallback) => {
      canFdFrameCb = cb;
      return () => {
        canFdFrameCb = null;
      };
    },
  };

  return {
    protocol: stub as unknown as DroneProtocol,
    raw: stub,
    deliverFrame: (
      data: Omit<Parameters<CanFrameCallback>[0], "timestamp"> & { timestamp?: number },
    ) => canFrameCb?.({ timestamp: Date.now(), ...data }),
    deliverFdFrame: (
      data: Omit<Parameters<CanFdFrameCallback>[0], "timestamp"> & { timestamp?: number },
    ) => canFdFrameCb?.({ timestamp: Date.now(), ...data }),
  };
}

describe("MavlinkCanForwardTransport — open / close", () => {
  it("issues CAN_FORWARD on open and reaches the 'open' state", async () => {
    const { protocol, raw } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol, { bus: 1 });

    const states: string[] = [];
    t.onState((s) => states.push(s));

    await t.open({ bitrate: 1_000_000 });

    expect(raw.enableCanForward).toHaveBeenCalledWith(1);
    expect(t.getState()).toBe("open");
    expect(states).toContain("opening");
    expect(states).toContain("open");
  });

  it("rejects when the FC ACKs CAN_FORWARD as a failure", async () => {
    const { protocol, raw } = makeStubProtocol();
    raw.enableCanForward.mockResolvedValueOnce({
      success: false,
      resultCode: 4,
      message: "FAILED",
    });
    const t = new MavlinkCanForwardTransport(protocol);
    await expect(t.open({ bitrate: 1_000_000 })).rejects.toThrow(/rejected/i);
    expect(t.getState()).toBe("error");
  });

  it("sends CAN_FORWARD(0) on close and lands in 'closed'", async () => {
    const { protocol, raw } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol, { bus: 2 });
    await t.open({ bitrate: 1_000_000 });
    raw.enableCanForward.mockClear();
    await t.close();
    expect(raw.enableCanForward).toHaveBeenCalledWith(0);
    expect(t.getState()).toBe("closed");
  });

  it("is idempotent: second close() resolves without throwing", async () => {
    const { protocol } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol);
    await t.open({ bitrate: 1_000_000 });
    await t.close();
    await expect(t.close()).resolves.toBeUndefined();
  });

  it("re-sends CAN_FORWARD while open so ArduPilot's 5 s forwarding timeout never lapses", async () => {
    vi.useFakeTimers();
    try {
      const { protocol, raw } = makeStubProtocol();
      const t = new MavlinkCanForwardTransport(protocol, { bus: 1 });
      await t.open({ bitrate: 1_000_000 });
      raw.enableCanForward.mockClear();
      await vi.advanceTimersByTimeAsync(4500);
      expect(raw.enableCanForward.mock.calls.filter(([bus]) => bus === 1).length).toBeGreaterThanOrEqual(2);
      await t.close();
      raw.enableCanForward.mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(raw.enableCanForward).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MavlinkCanForwardTransport — send", () => {
  it("routes <=8-byte frames through sendCanFrame", async () => {
    const { protocol, raw } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol, { bus: 1 });
    await t.open({ bitrate: 1_000_000 });

    const frame: CanFrame = {
      id: 0x123,
      extended: false,
      dlc: 4,
      data: new Uint8Array([1, 2, 3, 4]),
    };
    await t.send(frame);

    expect(raw.sendCanFrame).toHaveBeenCalledTimes(1);
    expect(raw.sendCanFrame).toHaveBeenCalledWith(1, 0x123, frame.data);
    expect(raw.sendCanFdFrame).not.toHaveBeenCalled();
    expect(t.getStats().txCount).toBe(1);
  });

  it("routes >8-byte frames through sendCanFdFrame", async () => {
    const { protocol, raw } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol, { bus: 1 });
    await t.open({ bitrate: 1_000_000 });

    const data = new Uint8Array(24);
    for (let i = 0; i < 24; i++) data[i] = i;
    await t.send({ id: 0x5, extended: false, dlc: 24, data });

    expect(raw.sendCanFdFrame).toHaveBeenCalledWith(1, 0x5, data);
    expect(raw.sendCanFrame).not.toHaveBeenCalled();
  });

  it("rejects sends while not open and bumps txErrors", async () => {
    const { protocol } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol);
    await expect(
      t.send({ id: 1, extended: false, dlc: 1, data: new Uint8Array([1]) }),
    ).rejects.toThrow(/not open/i);
    expect(t.getStats().txErrors).toBe(1);
  });
});

describe("MavlinkCanForwardTransport — inbound", () => {
  it("fans CAN_FRAME deliveries on the configured bus to onFrame subscribers", async () => {
    const { protocol, deliverFrame } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol, { bus: 1 });
    await t.open({ bitrate: 1_000_000 });

    const seen: CanFrame[] = [];
    t.onFrame((f) => seen.push(f));

    deliverFrame({
      bus: 1,
      len: 4,
      targetSystem: 0,
      targetComponent: 0,
      id: 0x7ff,
      data: new Uint8Array([10, 11, 12, 13, 0, 0, 0, 0]),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe(0x7ff);
    expect(seen[0].dlc).toBe(4);
    expect(seen[0].data.byteLength).toBe(4);
    expect(t.getStats().rxCount).toBe(1);
  });

  it("filters out frames from other buses", async () => {
    const { protocol, deliverFrame } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol, { bus: 1 });
    await t.open({ bitrate: 1_000_000 });

    let count = 0;
    t.onFrame(() => {
      count += 1;
    });

    deliverFrame({
      bus: 2,
      len: 1,
      targetSystem: 0,
      targetComponent: 0,
      id: 0x1,
      data: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
    });

    expect(count).toBe(0);
  });

  it("dispatches CANFD_FRAME on the configured bus too", async () => {
    const { protocol, deliverFdFrame } = makeStubProtocol();
    const t = new MavlinkCanForwardTransport(protocol, { bus: 1 });
    await t.open({ bitrate: 1_000_000 });

    const seen: CanFrame[] = [];
    t.onFrame((f) => seen.push(f));

    const data = new Uint8Array(64);
    data[0] = 0xff;
    deliverFdFrame({
      bus: 1,
      len: 16,
      targetSystem: 0,
      targetComponent: 0,
      id: 0x42,
      data,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].dlc).toBe(16);
    expect(seen[0].data.byteLength).toBe(16);
    expect(seen[0].data[0]).toBe(0xff);
  });
});
