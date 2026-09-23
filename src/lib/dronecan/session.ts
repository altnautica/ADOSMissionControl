/**
 * @module lib/dronecan/session
 * @description One live DroneCAN session over the flight controller's MAVLink
 * CAN forwarding: the transport, the client on top of it, and the fan-out of
 * node status and every decoded transfer into the node, bus and RPC-trace
 * stores the CAN pages read. The firmware flasher and the CAN configuration
 * page both open sessions through here.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types/protocol";
import type { CanTransport } from "@/lib/protocol/transport/can-transport";
import { MavlinkCanForwardTransport } from "@/lib/protocol/transport/mavlink-can-forward-transport";
import { DroneCanClient } from "./client";
import type { AnyTransferEvent } from "./client-types";
import { encodeMessageId, encodeServiceId } from "./frame-codec";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";
import { useDroneCanBusStore } from "@/stores/dronecan/bus-store";
import { useDroneCanRpcTraceStore } from "@/stores/dronecan/rpc-trace-store";

export interface DroneCanSession {
  client: DroneCanClient;
  transport: CanTransport;
  /** Stop the client and close the transport (turns CAN forwarding off). */
  close: () => Promise<void>;
}

/** Record one inbound transfer in the bus monitor and the RPC trace. */
export function publishTransfer(evt: AnyTransferEvent): void {
  useDroneCanBusStore.getState().pushFrame({
    t: evt.ts,
    dir: "in",
    // Every frame of a transfer carries the same 29-bit id, rebuilt here from
    // the transfer's fields.
    canId:
      evt.kind === "message"
        ? encodeMessageId(evt.priority, evt.dataTypeId, evt.srcNodeId)
        : encodeServiceId(
            evt.priority,
            evt.kind === "request",
            evt.dataTypeId,
            evt.dstNodeId ?? 0,
            evt.srcNodeId,
          ),
    decoded: {
      kind: evt.kind === "message" ? "message" : "service",
      dataTypeId: evt.dataTypeId,
      srcNodeId: evt.srcNodeId,
      dstNodeId: evt.dstNodeId,
      isRequest: evt.kind === "request",
    },
    payload: evt.payload,
    label: evt.typeName,
  });

  useDroneCanRpcTraceStore.getState().pushEvent({
    t: evt.ts,
    direction: "in",
    kind:
      evt.kind === "message"
        ? "broadcast"
        : evt.kind === "request"
          ? "request"
          : "response",
    dataTypeId: evt.dataTypeId,
    dataTypeName: evt.typeName ?? `0x${evt.dataTypeId.toString(16)}`,
    srcNodeId: evt.srcNodeId,
    dstNodeId: evt.dstNodeId,
    ok: true,
  });
}

/** Start a client on an already-open transport and wire it to the stores. */
export async function startDroneCanSession(transport: CanTransport): Promise<DroneCanSession> {
  const client = new DroneCanClient(transport);
  await client.start();
  const unsubs = [
    client.onNodeStatus((srcNodeId, status) => {
      useDroneCanNodeStore.getState().upsertStatus(srcNodeId, status);
    }),
    client.onAnyTransfer(publishTransfer),
  ];
  return {
    client,
    transport,
    close: async () => {
      for (const off of unsubs) off();
      try {
        await client.stop();
      } finally {
        await transport.close();
      }
    },
  };
}

/**
 * Open a session over MAVLink CAN forwarding on `bus` (1 or 2). Opening the
 * transport asks the FC to forward that bus; a refusal rejects here, so a
 * session only exists once frames can actually flow.
 */
export async function openForwardedDroneCanSession(protocol: DroneProtocol, bus: number): Promise<DroneCanSession> {
  const transport = new MavlinkCanForwardTransport(protocol, { bus });
  await transport.open({ bitrate: 1_000_000 });
  try {
    return await startDroneCanSession(transport);
  } catch (err) {
    await transport.close().catch(() => {});
    throw err;
  }
}
