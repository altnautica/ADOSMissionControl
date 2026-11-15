"use client";

/**
 * Per-node command sink: the command surface for a fleet node the GCS holds no
 * live flight-controller connection to.
 *
 * The connection-backed path can only ever command the one node whose protocol
 * is open. A fleet-operations surface needs to command a node that is not the
 * focused one, so this module resolves, for a given node, the transport that
 * can actually carry a command to it and wraps that transport in the same nine
 * methods a skill drives.
 *
 * Three transports, one destination. All terminate at the agent's command
 * route: the LAN transport posts to it directly, the relay-proxy transport
 * posts to it through a ground station's radio lane, and the cloud transport
 * queues a relay command whose payload the agent forwards to that same route
 * verbatim. So one command map covers all three, and the vocabulary a node
 * accepts is the same however it is reached.
 *
 * What differs is the truth each transport can report. LAN and relay-proxy
 * both wait for the vehicle's own acknowledgement, so their result is the
 * vehicle's answer — the relay simply spends a radio hop getting there. The
 * cloud transport is store-and-forward: the result says the command was
 * accepted onto the queue, and nothing more — the vehicle's answer lands later
 * on the queued row. `reportsVehicleAck` tells them apart so a surface can
 * label them honestly instead of implying an acknowledgement that never came.
 *
 * A command with no equivalent on the agent's route is refused with a failed
 * result naming the gap. It is never silently dropped and never reported as
 * having worked.
 *
 * @module nodes/command-sink
 * @license GPL-3.0-only
 */

import type { CommandResult } from "@/lib/protocol/types";
import type { SkillProtocol } from "@/lib/skills";
import type { AgentCommandName } from "@/lib/agent/agent-client/system";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { resolveDirectFcProtocol } from "@/lib/nodes/direct-fc-protocol";
import type { AgentModeFirmware } from "@/lib/agent/agent-mode-names";
import {
  NO_MAV_RESULT,
  dispatchOverLan,
  errorMessage,
  failed,
  makeDirectFcSink,
  makeSink,
  pageOriginIsHttps,
} from "@/lib/nodes/command-lanes";
import { resolveRelayedCommandReach } from "@/lib/nodes/relayed-command-reach";

/** The node fields a sink needs. A fleet node entry satisfies this. */
export interface CommandTargetNode {
  /** The agent's device id — the key for LAN credentials and the cloud queue. */
  deviceId: string;
  /** The cloud pairing row's document id; absent when the node is LAN-only. */
  convexId?: string;
  /** True for a directly-connected flight controller with no agent behind it. */
  isDirectFc?: boolean;
  /**
   * True when the node is enrolled SOLELY through a ground node's WFB relay —
   * the GCS never paired with it directly. The radio is its only path, and that
   * path does carry commands: `reachedVia` names the ground station whose
   * relay-proxy route forwards them to this drone's own agent.
   */
  isRelayed?: boolean;
  /**
   * The `node:<deviceId>` id of the ground node this drone is linked through
   * over WFB. It is the near end of the radio lane — without it the relay has
   * no addressable station to route a command through.
   */
  readonly reachedVia?: string;
}

/** How a command reaches a node. */
export type NodeCommandTransport = "lan" | "cloud" | "direct-fc" | "relay-proxy";

/**
 * Why no transport could carry a command to a node. Each value names something
 * the operator can act on, so a disabled control can say why rather than just
 * being dead.
 */
export type NodeCommandBlockedReason =
  /**
   * A directly-connected FC that is not currently driveable — its live protocol
   * is gone (a transient state). A connected direct FC is NOT blocked: it is
   * commanded through its own live flight-controller link, so this reason
   * appears only while that link is down.
   */
  | "direct-fc"
  /**
   * The node is reached only through a ground node's WFB radio relay, and that
   * ground station is not paired in this browser — so the GCS holds no near end
   * for the radio lane and nothing can carry a command. Distinct from an
   * unpaired node: the fix is to pair the ground station, not this drone.
   */
  | "relay-only"
  /** LAN credentials exist but the page origin blocks a plain-HTTP request. */
  | "lan-blocked-by-https"
  /** Neither LAN credentials in this browser nor a cloud pairing row. */
  | "not-paired"
  /** The node is cloud-paired but the caller supplied no queue to write to. */
  | "no-cloud-queue";

/**
 * A resolved command surface for one node. Implements the same nine methods a
 * skill drives, so it drops straight into a skill context.
 */
export interface NodeCommandSink extends SkillProtocol {
  /** Which transport carries commands to this node. */
  readonly transport: NodeCommandTransport;
  /**
   * True when a result carries the vehicle's own acknowledgement (LAN or
   * relay-proxy). False when a result only reports that the command was
   * accepted for delivery (cloud) — the vehicle's outcome arrives later on the
   * queued row.
   */
  readonly reportsVehicleAck: boolean;
  /** Whether this transport can carry `method` at all. */
  supports(method: keyof SkillProtocol): boolean;
}

/** The outcome of resolving a node's command transport. */
export type NodeCommandReach =
  | { readonly sink: NodeCommandSink; readonly blockedReason?: undefined }
  | { readonly sink: null; readonly blockedReason: NodeCommandBlockedReason };

/**
 * Delivery window for a flight command on the cloud relay. The lane is
 * store-and-forward, so without a window a command queued while the node was
 * unreachable would execute whenever the node next polled, possibly minutes
 * later and mid-flight. Past the window the queue fails the row instead of
 * handing it out, and the watcher reports the command failed.
 */
export const CLOUD_FLIGHT_COMMAND_TTL_MS = 10_000;

/**
 * Writes one relay command onto a device's cloud command queue. Supplied by the
 * caller because the queue client is React-scoped; a component holds it from
 * the enqueue mutation and hands it in.
 */
export type CloudCommandEnqueuer = (args: {
  deviceId: string;
  command: "send_command";
  args: { cmd: string; args: unknown[] };
  /** Delivery window; the queue never hands the row out once it closes. */
  ttlMs: number;
}) => Promise<{ commandId: string }>;

/**
 * A command that has just been accepted onto the cloud relay queue. The queue
 * row id is the handle a surface uses to watch the vehicle's own answer land:
 * the store-and-forward lane returns only "queued" synchronously, so without the
 * id a row could confirm queueing but never the acknowledgement. Reported the
 * instant the queue accepts the command, before the vehicle has seen it.
 */
export interface NodeQueuedCloudCommand {
  /** The device the command was queued for. */
  deviceId: string;
  /** The cloud queue row id, to watch its terminal status reactively. */
  commandId: string;
  /** The delivery window the row was queued with. */
  ttlMs: number;
}

export interface NodeCommandSinkOptions {
  /** The cloud queue writer. Without it, only the LAN transport can resolve. */
  enqueueCloudCommand?: CloudCommandEnqueuer | null;
  /**
   * Notified the instant a command is accepted onto the cloud relay queue,
   * carrying the queue row id. A surface subscribes to that id's terminal status
   * to replace the synchronous "queued" result with the vehicle's real answer.
   * Absent when no surface is watching, in which case the queue id is simply not
   * surfaced (the cloud dispatch still reports "queued" as before).
   */
  onQueued?: (queued: NodeQueuedCloudCommand) => void;
  /**
   * Whether the page is served over HTTPS, which blocks a plain-HTTP request to
   * a LAN agent. Defaults to the live page origin; pass it explicitly when the
   * caller has already resolved it.
   */
  originIsHttps?: boolean;
  /**
   * The firmware the agent identified on the node's vehicle. An agent lane's
   * mode command sends that firmware's name for a mode, and refuses a mode the
   * agent's table has no equivalent for. Without it the mode name is sent as
   * is and the agent decides.
   */
  agentFirmware?: AgentModeFirmware | null;
}

/** Queue one agent command on the cloud relay for later delivery. */
async function dispatchOverCloud(
  enqueue: CloudCommandEnqueuer,
  deviceId: string,
  cmd: AgentCommandName,
  args: unknown[],
  onQueued: ((queued: NodeQueuedCloudCommand) => void) | undefined,
): Promise<CommandResult> {
  try {
    const { commandId } = await enqueue({
      deviceId,
      command: "send_command",
      args: { cmd, args },
      ttlMs: CLOUD_FLIGHT_COMMAND_TTL_MS,
    });
    // Hand the queue row id to whoever is watching so it can surface the
    // vehicle's real answer when it lands; the synchronous result below still
    // reports only "queued", which is all that is true at this instant.
    onQueued?.({ deviceId, commandId, ttlMs: CLOUD_FLIGHT_COMMAND_TTL_MS });
    return {
      // The queue accepted the command. That is the whole of what happened —
      // the vehicle has not seen it yet, and the message says so.
      success: true,
      resultCode: NO_MAV_RESULT,
      message: `Queued for delivery over the cloud relay (${commandId}); the vehicle has not acknowledged it, and the command is dropped if the node does not take it within ${CLOUD_FLIGHT_COMMAND_TTL_MS / 1000} s`,
    };
  } catch (error) {
    return failed(errorMessage(error));
  }
}

/**
 * Resolve how commands reach `node`, preferring the LAN transport because it
 * reports the vehicle's own acknowledgement. Returns the reason nothing could
 * be resolved so a surface can disable its controls with an honest cause.
 */
export function resolveNodeCommandReach(
  node: CommandTargetNode,
  options: NodeCommandSinkOptions = {},
): NodeCommandReach {
  if (node.isDirectFc) {
    // A directly-connected FC has no agent lane, but its own live protocol is a
    // reach: drive it through that link so a plugged-in FC is commandable from a
    // fleet surface, with the vehicle's own answer. Only when the link is gone
    // does it fall back to the honest "no reach" state.
    const liveFc = resolveDirectFcProtocol(node.deviceId);
    if (liveFc) {
      return { sink: makeDirectFcSink(liveFc, node.deviceId) };
    }
    return { sink: null, blockedReason: "direct-fc" };
  }

  if (node.isRelayed) return resolveRelayedCommandReach(node, options);

  const originIsHttps = options.originIsHttps ?? pageOriginIsHttps();
  const lanAgent = resolveLocalAgentForDrone(node.deviceId);

  if (lanAgent && !originIsHttps) {
    return {
      sink: makeSink("lan", true, options.agentFirmware, (cmd, args) =>
        dispatchOverLan(lanAgent, cmd, args),
      ),
    };
  }

  const enqueue = options.enqueueCloudCommand;
  if (enqueue && node.convexId) {
    return {
      sink: makeSink("cloud", false, options.agentFirmware, (cmd, args) =>
        dispatchOverCloud(enqueue, node.deviceId, cmd, args, options.onQueued),
      ),
    };
  }

  if (lanAgent) {
    // The only way to hold LAN credentials and still be here is the HTTPS
    // block, since the cloud lane was already tried above.
    return { sink: null, blockedReason: "lan-blocked-by-https" };
  }
  if (!node.convexId) {
    return { sink: null, blockedReason: "not-paired" };
  }
  return { sink: null, blockedReason: "no-cloud-queue" };
}

/**
 * The command surface for `node`, or null when no transport can reach it. Use
 * {@link resolveNodeCommandReach} when the caller also needs the reason.
 */
export function resolveNodeCommandSink(
  node: CommandTargetNode,
  options: NodeCommandSinkOptions = {},
): NodeCommandSink | null {
  return resolveNodeCommandReach(node, options).sink;
}
