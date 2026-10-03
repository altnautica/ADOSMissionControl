/**
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  DroneCanClient,
  TimeoutError,
  ValueTag,
  type AnyTransferEvent,
} from "@/lib/dronecan/client";
import { encodeTransfer } from "@/lib/dronecan/transfer-coder";
import { DATA_TYPE_IDS, DSDL_SIGNATURES } from "@/lib/dronecan/signatures";
import { DEFAULT_PRIORITY } from "@/lib/dronecan/frame-codec";
import {
  encodeGetNodeInfoResponse,
} from "@/lib/dronecan/dsdl/get-node-info";
import {
  encodeParamGetSetResponse,
} from "@/lib/dronecan/dsdl/param-getset";
import {
  decodeFileReadResponse,
  encodeFileReadRequest,
} from "@/lib/dronecan/dsdl/file-read";
import type {
  CanFrame,
  CanTransport,
  CanTransportState,
  CanTransportStats,
} from "@/lib/protocol/transport/can-transport";

/**
 * Lightweight mock transport. Captures sent frames in `outbound` and lets the
 * test push inbound frames at the client via `inject()`.
 */
class MockTransport implements CanTransport {
  outbound: CanFrame[] = [];
  private frameListeners: Array<(f: CanFrame) => void> = [];
  private stateListeners: Array<(s: CanTransportState) => void> = [];
  private state: CanTransportState = "open";

  async open(): Promise<void> {
    this.state = "open";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
  async send(frame: CanFrame): Promise<void> {
    this.outbound.push(frame);
  }
  onFrame(cb: (frame: CanFrame) => void): () => void {
    this.frameListeners.push(cb);
    return () => {
      const i = this.frameListeners.indexOf(cb);
      if (i >= 0) this.frameListeners.splice(i, 1);
    };
  }
  onState(cb: (s: CanTransportState) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      const i = this.stateListeners.indexOf(cb);
      if (i >= 0) this.stateListeners.splice(i, 1);
    };
  }
  getState(): CanTransportState {
    return this.state;
  }
  getStats(): CanTransportStats {
    return { txCount: 0, rxCount: 0, txErrors: 0, rxErrors: 0 };
  }

  /** Push a single CanFrame inbound. */
  inject(frame: CanFrame): void {
    for (const l of this.frameListeners) l(frame);
  }

  /** Encode a service response and push every fragment to the client. */
  injectServiceResponse(args: {
    srcNodeId: number;
    dstNodeId: number;
    dataTypeId: number;
    signature: bigint;
    transferId: number;
    payload: Uint8Array;
  }): void {
    const frames = encodeTransfer(args.payload, {
      priority: DEFAULT_PRIORITY,
      dataTypeId: args.dataTypeId,
      srcNodeId: args.srcNodeId,
      dstNodeId: args.dstNodeId,
      isRequest: false,
      transferId: args.transferId,
      signature: args.signature,
      isService: true,
    });
    for (const f of frames) {
      this.inject({ id: f.canId, extended: true, dlc: f.data.length, data: f.data });
    }
  }

  /** Encode a service REQUEST inbound (test as a file-read peer). */
  injectServiceRequest(args: {
    srcNodeId: number;
    dstNodeId: number;
    dataTypeId: number;
    signature: bigint;
    transferId: number;
    payload: Uint8Array;
  }): void {
    const frames = encodeTransfer(args.payload, {
      priority: DEFAULT_PRIORITY,
      dataTypeId: args.dataTypeId,
      srcNodeId: args.srcNodeId,
      dstNodeId: args.dstNodeId,
      isRequest: true,
      transferId: args.transferId,
      signature: args.signature,
      isService: true,
    });
    for (const f of frames) {
      this.inject({ id: f.canId, extended: true, dlc: f.data.length, data: f.data });
    }
  }
}

const SELF = 127;
const TARGET = 22;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DroneCanClient — service request/response pairing", () => {
  it("paramGet resolves when a matching response transfer arrives", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();

    const promise = client.paramGet(TARGET, 5, { timeoutMs: 1000, retries: 0 });
    // Wait a microtask for the send to complete.
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.outbound.length).toBeGreaterThan(0);

    // The client claims transferId 0 on the first call for this key.
    transport.injectServiceResponse({
      srcNodeId: TARGET,
      dstNodeId: SELF,
      dataTypeId: DATA_TYPE_IDS.paramGetSet,
      signature: DSDL_SIGNATURES.paramGetSet,
      transferId: 0,
      payload: encodeParamGetSetResponse({
        value: { tag: ValueTag.Real, value: 1.5 },
        default_value: { tag: ValueTag.Empty },
        max_value: { tag: ValueTag.Empty },
        min_value: { tag: ValueTag.Empty },
        name: "BATT_MONITOR",
      }),
    });

    const res = await promise;
    expect(res.value.tag).toBe(ValueTag.Real);
    if (res.value.tag === ValueTag.Real) {
      expect(res.value.value).toBeCloseTo(1.5);
    }
    await client.stop();
  });

  it("getNodeInfo times out when the bus is silent", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();
    const promise = client.getNodeInfo(TARGET, { timeoutMs: 50, retries: 0 });
    // Attach the matcher BEFORE driving timers so any rejection is observed
    // synchronously inside the matcher's catch.
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(55);
    await assertion;
    await client.stop();
  });

  it("response with wrong transferId does NOT resolve the pending request", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();

    const promise = client.getNodeInfo(TARGET, { timeoutMs: 50, retries: 0 });
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await Promise.resolve();
    // Inject a response with a mismatched transferId (1 instead of 0).
    transport.injectServiceResponse({
      srcNodeId: TARGET,
      dstNodeId: SELF,
      dataTypeId: DATA_TYPE_IDS.GetNodeInfo,
      signature: DSDL_SIGNATURES.GetNodeInfo,
      transferId: 1,
      payload: minimalGetNodeInfoResponse(),
    });
    await vi.advanceTimersByTimeAsync(55);
    await assertion;
    await client.stop();
  });
});

describe("DroneCanClient — file-read server", () => {
  it("serves a 256-byte chunk for an in-range offset", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();

    const fileBytes = new Uint8Array(512);
    for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = i & 0xff;
    const served: Array<{ offset: number; len: number }> = [];
    client.serveFileReads({
      fileData: fileBytes,
      onChunkServed: (offset, len) => served.push({ offset, len }),
    });

    transport.outbound.length = 0;
    transport.injectServiceRequest({
      srcNodeId: TARGET,
      dstNodeId: SELF,
      dataTypeId: DATA_TYPE_IDS.fileRead,
      signature: DSDL_SIGNATURES.fileRead,
      transferId: 3,
      payload: encodeFileReadRequest({ offset: BigInt(0), path: "a.bin" }),
    });

    // Allow the async response to flush.
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(served.length).toBe(1);
    expect(served[0].offset).toBe(0);
    expect(served[0].len).toBe(256);
    // Sanity-check the wire response.
    expect(transport.outbound.length).toBeGreaterThan(0);
    const payload = reassemblePayload(transport.outbound);
    const res = decodeFileReadResponse(payload);
    expect(res.error.value).toBe(0);
    expect(res.data.length).toBe(256);
    await client.stop();
  });

  it("serves an empty chunk at EOF (offset >= file size)", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();
    const fileBytes = new Uint8Array(100);
    const served: Array<{ offset: number; len: number }> = [];
    client.serveFileReads({
      fileData: fileBytes,
      onChunkServed: (offset, len) => served.push({ offset, len }),
    });

    transport.outbound.length = 0;
    transport.injectServiceRequest({
      srcNodeId: TARGET,
      dstNodeId: SELF,
      dataTypeId: DATA_TYPE_IDS.fileRead,
      signature: DSDL_SIGNATURES.fileRead,
      transferId: 7,
      payload: encodeFileReadRequest({ offset: BigInt(100), path: "a.bin" }),
    });

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(served.length).toBe(1);
    expect(served[0].offset).toBe(100);
    expect(served[0].len).toBe(0);
    const payload = reassemblePayload(transport.outbound);
    const res = decodeFileReadResponse(payload);
    expect(res.data.length).toBe(0);
    await client.stop();
  });

  it("ignores a file read addressed to another node", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();
    const served: Array<{ offset: number; len: number }> = [];
    client.serveFileReads({
      fileData: new Uint8Array(512),
      onChunkServed: (offset, len) => served.push({ offset, len }),
    });

    transport.outbound.length = 0;
    transport.injectServiceRequest({
      srcNodeId: TARGET,
      dstNodeId: SELF - 1,
      dataTypeId: DATA_TYPE_IDS.fileRead,
      signature: DSDL_SIGNATURES.fileRead,
      transferId: 4,
      payload: encodeFileReadRequest({ offset: BigInt(0), path: "a.bin" }),
    });

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(served.length).toBe(0);
    expect(transport.outbound.length).toBe(0);
    await client.stop();
  });

  it("answers NOT_FOUND with no data for a path it does not serve", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();
    const served: Array<{ offset: number; len: number }> = [];
    client.serveFileReads({
      fileData: new Uint8Array(512).fill(0xaa),
      onChunkServed: (offset, len) => served.push({ offset, len }),
    });

    transport.outbound.length = 0;
    transport.injectServiceRequest({
      srcNodeId: TARGET,
      dstNodeId: SELF,
      dataTypeId: DATA_TYPE_IDS.fileRead,
      signature: DSDL_SIGNATURES.fileRead,
      transferId: 5,
      payload: encodeFileReadRequest({ offset: BigInt(0), path: "other.bin" }),
    });

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(served.length).toBe(0);
    const res = decodeFileReadResponse(reassemblePayload(transport.outbound));
    expect(res.error.value).toBe(2);
    expect(res.data.length).toBe(0);
    await client.stop();
  });

  it("emits onAnyTransfer for inbound NodeStatus", async () => {
    const transport = new MockTransport();
    const client = new DroneCanClient(transport, { selfNodeId: SELF });
    await client.start();
    const seen: AnyTransferEvent[] = [];
    client.onAnyTransfer((e) => seen.push(e));

    // Inject a NodeStatus broadcast (single-frame).
    const ns = new Uint8Array(7);
    ns[0] = 10; // uptime low
    ns[4] = 0; // health=0, mode=0
    const frames = encodeTransfer(ns, {
      priority: DEFAULT_PRIORITY,
      dataTypeId: DATA_TYPE_IDS.NodeStatus,
      srcNodeId: 11,
      transferId: 1,
      signature: DSDL_SIGNATURES.NodeStatus,
    });
    for (const f of frames) {
      transport.inject({
        id: f.canId,
        extended: true,
        dlc: f.data.length,
        data: f.data,
      });
    }
    await Promise.resolve();
    expect(seen.some((e) => e.typeName === "NodeStatus")).toBe(true);
    await client.stop();
  });
});

// ── helpers ────────────────────────────────────────────────

function minimalGetNodeInfoResponse(): Uint8Array {
  return encodeGetNodeInfoResponse({
    status: {
      uptime_sec: 1,
      health: 0,
      mode: 0,
      vendor_specific_status_code: 0,
    },
    software_version: {
      major: 1,
      minor: 0,
      optional_field_flags: 0,
      vcs_commit: 0,
      image_crc: BigInt(0),
    },
    hardware_version: {
      major: 1,
      minor: 0,
      unique_id: new Uint8Array(16),
      certificate_of_authenticity: new Uint8Array(0),
    },
    name: "test",
  });
}

/** Reassemble the payload from a list of frames the client sent in response. */
function reassemblePayload(frames: CanFrame[]): Uint8Array {
  if (frames.length === 0) return new Uint8Array(0);
  if (frames.length === 1) {
    // Single-frame transfer; strip tail byte.
    return frames[0].data.subarray(0, frames[0].data.length - 1);
  }
  // Multi-frame: skip the leading 2-byte CRC, strip the per-frame tail.
  let total = 0;
  for (const f of frames) total += f.data.length - 1;
  const merged = new Uint8Array(total);
  let off = 0;
  for (const f of frames) {
    merged.set(f.data.subarray(0, f.data.length - 1), off);
    off += f.data.length - 1;
  }
  return merged.subarray(2);
}
