/**
 * @module agent/agent-client/system
 * @description Agent generic command surface and outcome decoding.
 * @license GPL-3.0-only
 */

import { mavResultText } from "@/lib/cockpit/spec-strings";
import type { CommandResult } from "../../types";
import { agentRequest, type RequestContext } from "../transport";

/**
 * The named commands the agent's command route accepts. Anything outside this
 * catalog is rejected by the agent with a 400 before any frame is sent, so a
 * caller is better off checking membership than discovering it at dispatch.
 * `takeoff` reads `args[0]` as the altitude in metres; `mode` reads `args[0]`
 * as the flight-mode name. `killSwitch` force-disarms (emergency motor cut) and
 * `pauseMission` / `resumeMission` hold and continue an auto flight — the
 * agent-native additions the fleet board drives.
 */
export const AGENT_COMMAND_NAMES = [
  "arm",
  "disarm",
  "takeoff",
  "land",
  "rtl",
  "mode",
  "killSwitch",
  "pauseMission",
  "resumeMission",
] as const;

export type AgentCommandName = (typeof AGENT_COMMAND_NAMES)[number];

/**
 * What the flight controller did with a command, decoded from the agent's
 * response. The agent correlates the vehicle's acknowledgement rather than
 * firing and forgetting, so all three states are distinguishable:
 * acknowledged-and-accepted, acknowledged-and-rejected, and sent-but-never
 * acknowledged. The third is NOT a success — the command may or may not have
 * taken effect, and a caller must say so rather than imply either.
 */
export interface AgentCommandOutcome {
  /** The vehicle returned an acknowledgement for this command. */
  acknowledged: boolean;
  /** The vehicle acknowledged AND accepted it. */
  accepted: boolean;
  /** Raw MAV_RESULT from the acknowledgement; null when none arrived. */
  resultCode: number | null;
  /** Human-readable outcome: the vehicle's status text when it sent one. */
  message: string;
}

/**
 * Decode the agent's command response into an {@link AgentCommandOutcome}.
 * Pure and defensive: an envelope missing the acknowledgement block reads as
 * unacknowledged rather than as a success.
 */
export function decodeAgentCommandOutcome(body: unknown): AgentCommandOutcome {
  const ack =
    body && typeof body === "object"
      ? (body as { ack?: unknown }).ack
      : undefined;
  if (!ack || typeof ack !== "object") {
    return {
      acknowledged: false,
      accepted: false,
      resultCode: null,
      message: "Command sent; no acknowledgement from the flight controller",
    };
  }
  const block = ack as {
    observed?: unknown;
    accepted?: unknown;
    result?: unknown;
    result_name?: unknown;
    statustext?: unknown;
  };
  if (block.observed !== true) {
    return {
      acknowledged: false,
      accepted: false,
      resultCode: null,
      message: "Command sent; no acknowledgement from the flight controller",
    };
  }
  const accepted = block.accepted === true;
  const resultCode =
    typeof block.result === "number" ? block.result : null;
  const statusText =
    typeof block.statustext === "string" && block.statustext.length > 0
      ? block.statustext
      : null;
  // The ack's result name (`DENIED`) reads as the spec's `mav_result.*` text.
  const resultName =
    typeof block.result_name === "string" && block.result_name.length > 0
      ? (mavResultText(block.result_name) ?? block.result_name)
      : null;
  return {
    acknowledged: true,
    accepted,
    resultCode,
    message:
      statusText ??
      resultName ??
      (accepted ? "Accepted" : "Rejected by the flight controller"),
  };
}

/**
 * Run one named command on the agent's command route and return the vehicle's
 * acknowledgement. Rejects when the agent itself refuses (no FC link, unknown
 * command, unreachable host).
 */
export async function runCommand(
  ctx: RequestContext,
  cmd: string,
  args?: unknown[],
): Promise<AgentCommandOutcome> {
  const body = await agentRequest<unknown>(ctx, "/api/command", {
    method: "POST",
    body: JSON.stringify({ cmd, args: args ?? [] }),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  return decodeAgentCommandOutcome(body);
}

/**
 * A command round-trip waits for the vehicle's acknowledgement, so it needs a
 * longer deadline than a status read.
 */
const COMMAND_TIMEOUT_MS = 15_000;

export async function sendCommand(
  ctx: RequestContext,
  cmd: string,
  args?: unknown[],
): Promise<CommandResult> {
  const outcome = await runCommand(ctx, cmd, args);
  return { success: outcome.accepted, message: outcome.message };
}
