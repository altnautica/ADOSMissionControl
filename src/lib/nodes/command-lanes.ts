"use client";

/**
 * The lanes a node command sink is built from: the agent command each skill
 * method maps to, the dispatch over an agent's command route (directly on the
 * LAN, or through a ground station's relay-proxy route), and the two sink
 * shapes, one over an agent lane and one over a directly-connected FC's own
 * live protocol.
 *
 * @module nodes/command-lanes
 * @license GPL-3.0-only
 */

import type { CommandResult, UnifiedFlightMode } from "@/lib/protocol/types";
import type { SkillProtocol } from "@/lib/skills";
import { noteModeOnSuccess } from "@/lib/skills/flight-facts";
import {
  runCommand,
  type AgentCommandName,
} from "@/lib/agent/agent-client/system";
import {
  agentModeName,
  type AgentModeFirmware,
} from "@/lib/agent/agent-mode-names";
import type { NodeCommandSink, NodeCommandTransport } from "@/lib/nodes/command-sink";

/**
 * The agent command each skill method maps to, or null when the agent's command
 * route has no equivalent. Every skill method maps to a real agent command:
 * `killSwitch` force-disarms, `pauseMission` / `resumeMission` hold and continue
 * an auto flight. A method left null here would be refused rather than
 * substituting a different command that silently did something else.
 */
const AGENT_COMMAND_FOR: Record<keyof SkillProtocol, AgentCommandName | null> =
  {
    arm: "arm",
    disarm: "disarm",
    setFlightMode: "mode",
    returnToLaunch: "rtl",
    land: "land",
    takeoff: "takeoff",
    killSwitch: "killSwitch",
    pauseMission: "pauseMission",
    resumeMission: "resumeMission",
  };

/**
 * Result code used when no MAV_RESULT was ever produced — the command was
 * refused before reaching a vehicle, the transport failed, or the vehicle never
 * acknowledged. Matches how the MSP adapter reports a command it cannot carry.
 */
export const NO_MAV_RESULT = -1;

function refused(method: keyof SkillProtocol): CommandResult {
  return {
    success: false,
    resultCode: NO_MAV_RESULT,
    message: `${method} has no equivalent on the agent command lane`,
  };
}

export function failed(message: string): CommandResult {
  return { success: false, resultCode: NO_MAV_RESULT, message };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when the page origin blocks a plain-HTTP request to a LAN agent. */
export function pageOriginIsHttps(): boolean {
  return (
    typeof window !== "undefined" && window.location.protocol === "https:"
  );
}

/** What came back from one command on an agent's command route. `answered`
 * is false when the route returned no command answer: the request failed or
 * timed out, or the agent or a hop on the way answered with an HTTP error, so
 * neither the pilot nor the flight controller answered; `result` then carries
 * why. */
export interface LanSendOutcome {
  answered: boolean;
  result: CommandResult;
}

/** Send one agent command over the LAN and report the vehicle's answer, or
 * that none came back. `relay` marks the ground station's relay-proxy prefix,
 * whose requests cross the radio rather than the LAN. Nothing reads the flag
 * on this path today (`runCommand` pins its own 15 s deadline, which already
 * clears the ground's bound), but a request context that misdescribes its own
 * transport is a bug the moment anything branches on it. */
export async function sendOverLan(
  agent: { agentUrl: string; apiKey: string; relay?: boolean },
  cmd: AgentCommandName,
  args: unknown[],
): Promise<LanSendOutcome> {
  try {
    const outcome = await runCommand(
      {
        baseUrl: agent.agentUrl,
        apiKey: agent.apiKey,
        relay: agent.relay ?? false,
      },
      cmd,
      args,
    );
    return {
      answered: true,
      result: {
        success: outcome.accepted,
        resultCode: outcome.resultCode ?? NO_MAV_RESULT,
        message: outcome.message,
      },
    };
  } catch (error) {
    return { answered: false, result: failed(errorMessage(error)) };
  }
}

/** Dispatch one agent command over the LAN and report the vehicle's answer
 * (see {@link sendOverLan}). */
export async function dispatchOverLan(
  agent: { agentUrl: string; apiKey: string; relay?: boolean },
  cmd: AgentCommandName,
  args: unknown[],
): Promise<CommandResult> {
  return (await sendOverLan(agent, cmd, args)).result;
}

/** Build a sink over one dispatch function. */
export function makeSink(
  transport: NodeCommandTransport,
  reportsVehicleAck: boolean,
  agentFirmware: AgentModeFirmware | null | undefined,
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
    setFlightMode: (mode: UnifiedFlightMode) => {
      const name = agentFirmware ? agentModeName(agentFirmware, mode) : mode;
      return name === null
        ? Promise.resolve(
            failed(`${mode} has no equivalent in the agent's mode table for this vehicle`),
          )
        : run("setFlightMode", [name]);
    },
    returnToLaunch: () => run("returnToLaunch"),
    land: () => run("land"),
    takeoff: (altitude: number) => run("takeoff", [altitude]),
    // The confirmation lives at the dispatcher; the lane refuses to enqueue a
    // flight termination it was not told was confirmed rather than trusting a
    // caller that skipped the confirm.
    killSwitch: (confirmed: boolean) =>
      confirmed
        ? run("killSwitch")
        : Promise.resolve({
            success: false,
            resultCode: -1,
            message: "Flight termination requires explicit confirmation",
          }),
    pauseMission: () => run("pauseMission"),
    resumeMission: () => run("resumeMission"),
  };
}

/**
 * Build a sink over a directly-connected FC's own live protocol. Unlike the
 * agent lanes, every command is a real protocol call the vehicle answers, so
 * `reportsVehicleAck` is true and every method is carried (the autonomous-nav
 * gate, handled upstream, decides which are offered — not the lane). The
 * protocol is used only through its command surface; a live `DroneProtocol`
 * satisfies that surface directly. An accepted mode, return or landing is
 * recorded for `droneId` (its drone-manager id) as this station's command.
 */
export function makeDirectFcSink(protocol: SkillProtocol, droneId: string): NodeCommandSink {
  return {
    transport: "direct-fc",
    reportsVehicleAck: true,
    supports: () => true,
    arm: () => protocol.arm(),
    disarm: () => protocol.disarm(),
    setFlightMode: (mode: UnifiedFlightMode) => noteModeOnSuccess(droneId, mode, protocol.setFlightMode(mode)),
    returnToLaunch: () => noteModeOnSuccess(droneId, "RTL", protocol.returnToLaunch()),
    land: () => noteModeOnSuccess(droneId, "LAND", protocol.land()),
    takeoff: (altitude: number) => protocol.takeoff(altitude),
    killSwitch: (confirmed: boolean) => protocol.killSwitch(confirmed),
    pauseMission: () => protocol.pauseMission(),
    resumeMission: () => protocol.resumeMission(),
  };
}
