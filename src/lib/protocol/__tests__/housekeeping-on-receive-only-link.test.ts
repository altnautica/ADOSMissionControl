/**
 * @description Adapter housekeeping must stay silent on a receive-only link.
 *
 * When the relay transport began refusing writes it cannot deliver, the
 * adapter's own housekeeping — the stream-rate requests issued at connect and
 * again every ten seconds — became a throwing call. Unguarded, that turns
 * "watch but do not command" into "nothing at all": the connect path rejects
 * and the operator loses the telemetry the link still carries perfectly well.
 *
 * These sends are not operator actions. Nothing awaits them and the vehicle
 * streams on its defaults without them, so skipping is correct where an
 * operator command must still fail loudly.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { requestDataStreams } from "../mavlink-adapter-frame-handlers";
import type { Transport } from "../types/transport";

function transport(over: Partial<Transport>): Transport {
  return {
    type: "mqtt-mavlink",
    isConnected: true,
    canCommand: false,
    connect: async () => {},
    disconnect: async () => {},
    send: vi.fn(),
    on: () => {},
    off: () => {},
    ...over,
  } as Transport;
}

function state(t: Transport) {
  return {
    transport: t,
    firmwareHandler: null,
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
  } as unknown as Parameters<typeof requestDataStreams>[0];
}

describe("requestDataStreams on a receive-only link", () => {
  it("neither sends nor throws when the transport cannot carry a command", () => {
    const send = vi.fn(() => {
      throw new Error("Relay credential is receive-only");
    });
    const t = transport({ canCommand: false, send });
    // Must not throw: this runs inside connect() and on a 10s interval, so a
    // throw here rejects the session or becomes a recurring unhandled error.
    expect(() => requestDataStreams(state(t))).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("still sends on a link that can carry commands", () => {
    const send = vi.fn();
    const t = transport({ canCommand: true, send });
    requestDataStreams(state(t));
    expect(send).toHaveBeenCalled();
  });

  it("stays silent on a disconnected link regardless of authority", () => {
    const send = vi.fn();
    const t = transport({ isConnected: false, canCommand: true, send });
    requestDataStreams(state(t));
    expect(send).not.toHaveBeenCalled();
  });
});
