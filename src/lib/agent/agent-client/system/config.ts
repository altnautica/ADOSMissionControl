/**
 * @module agent/agent-client/system
 * @description Agent config read/write and service restarts.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import { ServiceRestartResultSchema, SupervisorRestartResultSchema } from "../../schemas";
import {
  AgentHttpError,
  agentRequest,
  withForceQuery,
  type ArmedOverrideOptions,
  type RequestContext,
} from "../transport";
import {
  configWriteFailure,
  configWriteRefusalBody,
  type ConfigWriteResult,
} from "@/lib/agent/config-write";

export function getConfig(ctx: RequestContext): Promise<Record<string, unknown>> {
  return agentRequest<Record<string, unknown>>(ctx, "/api/config");
}

/**
 * Write a single config value via the agent's PUT /api/config endpoint.
 * Dot-separated key paths are supported by the agent
 * (e.g. `ground_station.display.type`). The agent coerces the string
 * value to the underlying field type, so the caller hands in a plain string.
 * Returns the agent's answer, including its refusal bodies (the 500 persist
 * failure, the 422 `E_INVALID` / `E_VALIDATION`), so `configWriteFailure`
 * names the node's own reason. A flight-affecting key (the `mavlink.*`
 * transport and identity) is refused with `AgentArmedRefusal` while armed
 * unless `opts.force` is set.
 */
export async function setConfigValue(
  ctx: RequestContext,
  key: string,
  value: string,
  opts?: ArmedOverrideOptions,
): Promise<ConfigWriteResult> {
  try {
    return await agentRequest<ConfigWriteResult>(ctx, "/api/config", {
      method: "PUT",
      body: JSON.stringify(opts?.force ? { key, value, force: true } : { key, value }),
    });
  } catch (err) {
    if (err instanceof AgentHttpError) {
      let body: unknown = null;
      try {
        body = JSON.parse(err.body);
      } catch {
        throw err;
      }
      const failure = configWriteRefusalBody(body);
      if (failure) return failure;
    }
    throw err;
  }
}

export type ServiceRestartResult = z.infer<typeof ServiceRestartResultSchema>;
export type SupervisorRestartResult = z.infer<typeof SupervisorRestartResultSchema>;

/** The single-unit restart runs `systemctl restart` (up to 30 s) and then
 * waits up to ~5 s for a fresh MainPID before it answers, so the request
 * deadline sits above both. */
export const SERVICE_RESTART_TIMEOUT_MS = 40_000;

/** Restart one agent unit. The agent answers HTTP 200 for every outcome, so
 * a `status:"error"` body (unknown unit, failed or unconfirmed restart) is
 * thrown with the agent's message. A flight-critical unit is refused with
 * `AgentArmedRefusal` while armed unless `opts.force` is set. */
export async function restartService(
  ctx: RequestContext,
  name: string,
  opts?: ArmedOverrideOptions,
): Promise<ServiceRestartResult> {
  const res = await agentRequest(
    ctx,
    withForceQuery(`/api/services/${encodeURIComponent(name)}/restart`, opts),
    {
      method: "POST",
      schema: ServiceRestartResultSchema,
      timeoutMs: SERVICE_RESTART_TIMEOUT_MS,
    },
  );
  if (res.status !== "ok") throw new Error(res.message);
  return res;
}

/** Restart the supervisor, which cycles every agent service. The agent
 * schedules the restart and answers at once; `ok:false` means it could not
 * schedule it and is thrown with the agent's message. Refused with
 * `AgentArmedRefusal` while armed unless `opts.force` is set. */
export async function restartSupervisor(
  ctx: RequestContext,
  opts?: ArmedOverrideOptions,
): Promise<SupervisorRestartResult> {
  const res = await agentRequest(ctx, withForceQuery("/api/v1/system/restart-supervisor", opts), {
    method: "POST",
    schema: SupervisorRestartResultSchema,
  });
  if (!res.ok) throw new Error(res.message);
  return res;
}
