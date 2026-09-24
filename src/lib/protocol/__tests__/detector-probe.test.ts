/**
 * @module protocol/detector-probe.test
 * @description The connect-time protocol probe sees every checksum-valid reply
 * however the transport chunks it (two replies in one read, one reply split
 * across reads), and a link proven to speak MSP gets the MSP adapter whatever
 * variant it names.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";

const created: string[] = [];
vi.mock("../select-fc-adapter", () => ({
  createProtocolAdapter: async (protocol: string) => {
    created.push(protocol);
    return { connect: async () => ({ firmwareType: "unknown" }) };
  },
}));

import { detectProtocol } from "../detector";
import { connectWithDetection } from "../connect-with-detection";
import type { Transport } from "../types";

/** An MSPv1 reply frame ($M>). */
function mspReply(command: number, payload: number[]): number[] {
  let checksum = payload.length ^ command;
  for (const b of payload) checksum ^= b;
  return [0x24, 0x4d, 0x3e, payload.length, command, ...payload, checksum];
}

const API_VERSION = mspReply(1, [0, 1, 46]);
const variant = (id: string) => mspReply(2, [...id].map((c) => c.charCodeAt(0)));

/** A fake byte link whose replies are pushed by the test. */
function link() {
  const handlers = new Set<(d: Uint8Array) => void>();
  return {
    send: () => {},
    onData: (h: (d: Uint8Array) => void) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    push: (bytes: number[]) => {
      for (const h of [...handlers]) h(Uint8Array.from(bytes));
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  created.length = 0;
});

describe("MSP probe", () => {
  it("reads FC_VARIANT when it shares a read with API_VERSION", async () => {
    vi.useFakeTimers();
    const l = link();
    const result = detectProtocol(l.send, l.onData);
    await vi.advanceTimersByTimeAsync(3000); // MAVLink probe hears nothing
    l.push([...API_VERSION, ...variant("BTFL")]);
    expect(await result).toEqual({ protocol: "msp", firmwareType: "betaflight" });
  });

  it("reads a reply split across two reads", async () => {
    vi.useFakeTimers();
    const l = link();
    const result = detectProtocol(l.send, l.onData);
    await vi.advanceTimersByTimeAsync(3000);
    const reply = variant("INAV");
    l.push(reply.slice(0, 4));
    l.push(reply.slice(4));
    expect(await result).toEqual({ protocol: "msp", firmwareType: "inav" });
  });
});

describe("adapter selection", () => {
  it("drives a confirmed MSP board with an unmodeled variant over MSP", async () => {
    vi.useFakeTimers();
    const l = link();
    const transport = {
      send: l.send,
      on: (_e: string, h: (d: Uint8Array) => void) => { l.onData(h); },
      off: () => {},
    } as unknown as Transport; // the three members the probe touches
    const connecting = connectWithDetection(transport);
    await vi.advanceTimersByTimeAsync(3000);
    l.push(variant("EMUF"));
    await connecting;
    expect(created).toEqual(["msp"]);
  });
});
