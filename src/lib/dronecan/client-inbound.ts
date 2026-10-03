/**
 * @module client-inbound
 * @description Inbound transfer dispatcher for the DroneCAN client. Pulls the
 * NodeStatus decode + response correlation + file.Read serving logic out of
 * `client.ts` to keep that file under the 500-LOC hard rule.
 * @license GPL-3.0-only
 */

import type { CanFrame } from "../protocol/transport/can-transport";
import type {
  DecodedTransfer,
  OutboundTransfer,
} from "./transfer-coder";
import { encodeTransfer } from "./transfer-coder";
import { DATA_TYPE_IDS, DSDL_SIGNATURES } from "./signatures";
import { DEFAULT_PRIORITY } from "./frame-codec";
import {
  decodeNodeStatus,
  type NodeStatus,
} from "./dsdl/node-status";
import {
  decodeFileReadRequest,
  encodeFileReadResponse,
  FILE_READ_MAX_DATA,
} from "./dsdl/file-read";
import { decodeFix2, type GnssFix2 } from "./dsdl/gnss-fix2";
import {
  decodeMagneticFieldStrength2,
  type MagneticFieldStrength2,
} from "./dsdl/magnetic-field-strength-2";
import {
  typeNameFor,
  type AnyTransferEvent,
  type FileReadServerState,
} from "./client-types";
import type { PendingRegistry, PendingKey } from "./client-pending";

/** Callbacks the client wires into the dispatcher. */
export interface InboundContext {
  pending: PendingRegistry;
  selfNodeId(): number;
  fileServer(): FileReadServerState | null;
  sendFrame(frame: CanFrame): Promise<void>;
  emitNodeStatus(srcNodeId: number, status: NodeStatus): void;
  emitAnyTransfer(evt: AnyTransferEvent): void;
  emitFix2(srcNodeId: number, fix: GnssFix2): void;
  emitMag2(srcNodeId: number, mag: MagneticFieldStrength2): void;
}

/** Route a decoded transfer to the right handler. */
export function dispatchInboundTransfer(
  t: DecodedTransfer,
  ctx: InboundContext,
): void {
  const ts = Date.now();
  if (t.kind === "message") {
    if (t.dataTypeId === DATA_TYPE_IDS.NodeStatus) {
      handleNodeStatus(t, ts, ctx);
      return;
    }
    if (t.dataTypeId === DATA_TYPE_IDS.GnssFix2) {
      handleFix2(t, ts, ctx);
      return;
    }
    if (t.dataTypeId === DATA_TYPE_IDS.MagneticFieldStrength2) {
      handleMag2(t, ts, ctx);
      return;
    }
  }
  if (t.kind === "service") {
    if (t.isRequest === true) {
      handleIncomingRequest(t, ts, ctx);
      return;
    }
    if (t.isRequest === false) {
      handleIncomingResponse(t, ts, ctx);
      return;
    }
  }
  emitAnyFromDecoded(t, ts, ctx);
}

function handleFix2(
  t: DecodedTransfer,
  ts: number,
  ctx: InboundContext,
): void {
  let fix: GnssFix2 | null = null;
  try {
    fix = decodeFix2(t.payload);
  } catch {
    fix = null;
  }
  if (fix) ctx.emitFix2(t.srcNodeId, fix);
  ctx.emitAnyTransfer({
    ts,
    kind: "message",
    srcNodeId: t.srcNodeId,
    dataTypeId: t.dataTypeId,
    typeName: typeNameFor(t.dataTypeId, "message"),
    transferId: t.transferId,
    priority: t.priority,
    payload: t.payload,
  });
}

function handleMag2(
  t: DecodedTransfer,
  ts: number,
  ctx: InboundContext,
): void {
  let mag: MagneticFieldStrength2 | null = null;
  try {
    mag = decodeMagneticFieldStrength2(t.payload);
  } catch {
    mag = null;
  }
  if (mag) ctx.emitMag2(t.srcNodeId, mag);
  ctx.emitAnyTransfer({
    ts,
    kind: "message",
    srcNodeId: t.srcNodeId,
    dataTypeId: t.dataTypeId,
    typeName: typeNameFor(t.dataTypeId, "message"),
    transferId: t.transferId,
    priority: t.priority,
    payload: t.payload,
  });
}

function handleNodeStatus(
  t: DecodedTransfer,
  ts: number,
  ctx: InboundContext,
): void {
  let status: NodeStatus | null = null;
  try {
    status = decodeNodeStatus(t.payload);
  } catch {
    status = null;
  }
  if (status) ctx.emitNodeStatus(t.srcNodeId, status);
  ctx.emitAnyTransfer({
    ts,
    kind: "message",
    srcNodeId: t.srcNodeId,
    dataTypeId: t.dataTypeId,
    typeName: typeNameFor(t.dataTypeId, "message"),
    transferId: t.transferId,
    priority: t.priority,
    payload: t.payload,
  });
}

function handleIncomingResponse(
  t: DecodedTransfer,
  ts: number,
  ctx: InboundContext,
): void {
  const key: PendingKey = {
    srcNodeId: t.srcNodeId,
    dstNodeId: t.dstNodeId ?? ctx.selfNodeId(),
    dataTypeId: t.dataTypeId,
    transferId: t.transferId,
  };
  ctx.pending.resolve(key, t.payload);
  ctx.emitAnyTransfer({
    ts,
    kind: "response",
    srcNodeId: t.srcNodeId,
    dstNodeId: t.dstNodeId,
    dataTypeId: t.dataTypeId,
    typeName: typeNameFor(t.dataTypeId, "service"),
    transferId: t.transferId,
    priority: t.priority,
    payload: t.payload,
  });
}

function handleIncomingRequest(
  t: DecodedTransfer,
  ts: number,
  ctx: InboundContext,
): void {
  ctx.emitAnyTransfer({
    ts,
    kind: "request",
    srcNodeId: t.srcNodeId,
    dstNodeId: t.dstNodeId,
    dataTypeId: t.dataTypeId,
    typeName: typeNameFor(t.dataTypeId, "service"),
    transferId: t.transferId,
    priority: t.priority,
    payload: t.payload,
  });
  if (t.dataTypeId === DATA_TYPE_IDS.fileRead) {
    handleFileReadRequest(t, ctx).catch(() => {
      // network send failures must not crash the decoder
    });
  }
}

/** uavcan.protocol.file.Error NOT_FOUND. */
const FILE_ERROR_NOT_FOUND = 2;

async function handleFileReadRequest(
  t: DecodedTransfer,
  ctx: InboundContext,
): Promise<void> {
  // Only requests addressed to this node are ours to answer: a read aimed at
  // another node's file server must never get our image bytes back.
  if (t.dstNodeId !== ctx.selfNodeId()) return;
  const server = ctx.fileServer();
  if (!server) return;
  let request;
  try {
    request = decodeFileReadRequest(t.payload);
  } catch {
    return;
  }
  const offset = Number(request.offset);
  const servesPath = request.path === server.path;
  const total = server.fileData.length;
  const chunk =
    !servesPath || offset >= total
      ? new Uint8Array(0)
      : server.fileData.subarray(
          offset,
          Math.min(offset + FILE_READ_MAX_DATA, total),
        );
  const payload = encodeFileReadResponse({
    error: { value: servesPath ? 0 : FILE_ERROR_NOT_FOUND },
    data: chunk,
  });
  const descriptor: OutboundTransfer = {
    priority: DEFAULT_PRIORITY,
    dataTypeId: DATA_TYPE_IDS.fileRead,
    srcNodeId: ctx.selfNodeId(),
    dstNodeId: t.srcNodeId,
    isRequest: false,
    transferId: t.transferId,
    signature: DSDL_SIGNATURES.fileRead,
    isService: true,
  };
  const frames = encodeTransfer(payload, descriptor);
  for (const f of frames) {
    await ctx.sendFrame({
      id: f.canId,
      extended: true,
      dlc: f.data.length,
      data: f.data,
    });
  }
  if (servesPath) server.onChunkServed?.(offset, chunk.length);
}

function emitAnyFromDecoded(
  t: DecodedTransfer,
  ts: number,
  ctx: InboundContext,
): void {
  ctx.emitAnyTransfer({
    ts,
    kind:
      t.kind === "service"
        ? t.isRequest
          ? "request"
          : "response"
        : "message",
    srcNodeId: t.srcNodeId,
    dstNodeId: t.dstNodeId,
    dataTypeId: t.dataTypeId,
    typeName: typeNameFor(
      t.dataTypeId,
      t.kind === "service" ? "service" : "message",
    ),
    transferId: t.transferId,
    priority: t.priority,
    payload: t.payload,
  });
}
