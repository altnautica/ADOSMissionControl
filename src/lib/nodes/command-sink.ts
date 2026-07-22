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
 * Two transports, one destination. Both terminate at the agent's command route:
 * the LAN transport posts to it directly, and the cloud transport queues a
 * relay command whose payload the agent forwards to that same route verbatim.
 * So one command map covers both, and the vocabulary a node accepts is the
 * same either way.
 *
 * What differs is the truth each transport can report. The LAN transport waits
 * for the vehicle's own acknowledgement, so its result is the vehicle's answer.
 * The cloud transport is store-and-forward: the result says the command was
 * accepted onto the queue, and nothing more — the vehicle's answer lands later
 * on the queued row. `reportsVehicleAck` tells the two apart so a surface can
 * label them honestly instead of implying an acknowledgement that never came.
 *
 * A command with no equivalent on the agent's route is refused with a failed
 * result naming the gap. It is never silently dropped and never reported as
 * having worked.
 *
 * @module nodes/command-sink
 * @license GPL-3.0-only
 */

import type { CommandResult, UnifiedFlightMode } from "@/lib/protocol/types";
import type { SkillProtocol } from "@/lib/skills";
import {
  runCommand,
  type AgentCommandName,
} from "@/lib/agent/agent-client/system";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";

/** The node fields a sink needs. A fleet node entry satisfies this. */
export interface CommandTargetNode {
  /** The agent's device id — the key for LAN credentials and the cloud queue. */
  deviceId: string;
  /** The cloud pairing row's document id; absent when the node is LAN-only. */
  convexId?: string;
  /** True for a directly-connected flight controller with no agent behind it. */
  isDirectFc?: boolean;
}

/** How a command reaches a node. */
export type NodeCommandTransport = "lan" | "cloud";

/**
 * Why no transport could carry a command to a node. Each value names something
 * the operator can act on, so a disabled control can say why rather than just
 * being dead.
 */
export type NodeCommandBlockedReason =
  /** A directly-connected FC has no agent, so it has no agent command lane. */
  | "direct-fc"
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
   * True when a result carries the vehicle's own acknowledgement (LAN). False
   * when a result only reports that the command was accepted for delivery
   * (cloud) — the vehicle's outcome arrives later on the queued row.
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
 * Writes one relay command onto a device's cloud command queue. Supplied by the
 * caller because the queue client is React-scoped; a component holds it from
 * the enqueue mutation and hands it in.
 */
export type CloudCommandEnqueuer = (args: {
  deviceId: string;
  command: "send_command";
  args: { cmd: string; args: unknown[] };
}) => Promise<{ commandId: string }>;

export interface NodeCommandSinkOptions {
  /** The cloud queue writer. Without it, only the LAN transport can resolve. */
  enqueueCloudCommand?: CloudCommandEnqueuer | null;
  /**
   * Whether the page is served over HTTPS, which blocks a plain-HTTP request to
   * a LAN agent. Defaults to the live page origin; pass it explicitly when the
   * caller has already resolved it.
   */
  originIsHttps?: boolean;
}

/**
 * The agent command each skill method maps to, or null when the agent's command
 * route has no equivalent. Kill, pause-mission and resume-mission are absent
 * from that route: substituting a different command (a mode change, say) would
 * silently do something other than what the operator asked for, so they are
 * refused instead.
 */
const AGENT_COMMAND_FOR: Record<keyof SkillProtocol, AgentCommandName | null> =
  {
    arm: "arm",
    disarm: "disarm",
    setFlightMode: "mode",
    returnToLaunch: "rtl",
    land: "land",
    takeoff: "takeoff",
    killSwitch: null,
    pauseMission: null,
    resumeMission: null,
  };

/**
 * Result code used when no MAV_RESULT was ever produced — the command was
 * refused before reaching a vehicle, the transport failed, or the vehicle never
 * acknowledged. Matches how the MSP adapter reports a command it cannot carry.
 */
const NO_MAV_RESULT = -1;

function refused(method: keyof SkillProtocol): CommandResult {
  return {
    success: false,
    resultCode: NO_MAV_RESULT,
    message: `${method} has no equivalent on the agent command lane`,
  };
}

function failed(message: string): CommandResult {
  return { success: false, resultCode: NO_MAV_RESULT, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when the page origin blocks a plain-HTTP request to a LAN agent. */
function pageOriginIsHttps(): boolean {
  return (
    typeof window !== "undefined" && window.location.protocol === "https:"
  );
}

/** Dispatch one agent command over the LAN and report the vehicle's answer. */
async function dispatchOverLan(
  agent: { agentUrl: string; apiKey: string },
  cmd: AgentCommandName,
  args: unknown[],
): Promise<CommandResult> {
  try {
    const outcome = await runCommand(
      { baseUrl: agent.agentUrl, apiKey: agent.apiKey },
      cmd,
      args,
    );
    return {
      success: outcome.accepted,
      resultCode: outcome.resultCode ?? NO_MAV_RESULT,
      message: outcome.message,
    };
  } catch (error) {
    return failed(errorMessage(error));
  }
}

/** Queue one agent command on the cloud relay for later delivery. */
async function dispatchOverCloud(
  enqueue: CloudCommandEnqueuer,
  deviceId: string,
  cmd: AgentCommandName,
  args: unknown[],
): Promise<CommandResult> {
  try {
    const { commandId } = await enqueue({
      deviceId,
      command: "send_command",
      args: { cmd, args },
    });
    return {
      // The queue accepted the command. That is the whole of what happened —
      // the vehicle has not seen it yet, and the message says so.
      success: true,
      resultCode: NO_MAV_RESULT,
      message: `Queued for delivery over the cloud relay (${commandId}); the vehicle has not acknowledged it`,
    };
  } catch (error) {
    return failed(errorMessage(error));
  }
}

/** Build a sink over one dispatch function. */
function makeSink(
  transport: NodeCommandTransport,
  reportsVehicleAck: boolean,
  dispatch: (cmd: AgentCommandName, args: unknown[]) => Promise<CommandResult>,
): NodeCommandSink {
  const run = (
    method: keyof SkillProtocol,
    args: unknown[] = [],
  ): Promise<CommandResult> => {
    const cmd = AGENT_COMMAND_FOR[method];
    if (!cmd) return Promise.resolve(refused(method));
    return dispatch(cmd, args);
  };

  return {
    transport,
    reportsVehicleAck,
    supports: (method) => AGENT_COMMAND_FOR[method] !== null,
    arm: () => run("arm"),
    disarm: () => run("disarm"),
    setFlightMode: (mode: UnifiedFlightMode) => run("setFlightMode", [mode]),
    returnToLaunch: () => run("returnToLaunch"),
    land: () => run("land"),
    takeoff: (altitude: number) => run("takeoff", [altitude]),
    killSwitch: () => run("killSwitch"),
    pauseMission: () => run("pauseMission"),
    resumeMission: () => run("resumeMission"),
  };
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
    return { sink: null, blockedReason: "direct-fc" };
  }

  const originIsHttps = options.originIsHttps ?? pageOriginIsHttps();
  const lanAgent = resolveLocalAgentForDrone(node.deviceId);

  if (lanAgent && !originIsHttps) {
    return {
      sink: makeSink("lan", true, (cmd, args) =>
        dispatchOverLan(lanAgent, cmd, args),
      ),
    };
  }

  const enqueue = options.enqueueCloudCommand;
  if (enqueue && node.convexId) {
    return {
      sink: makeSink("cloud", false, (cmd, args) =>
        dispatchOverCloud(enqueue, node.deviceId, cmd, args),
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
