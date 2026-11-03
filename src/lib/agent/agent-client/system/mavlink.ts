/**
 * @module agent/agent-client/system
 * @description MAVLink port enumeration, FC source selection and ping.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import type { FcSource, MavlinkPort } from "../../types";
import { MavlinkPortsResponseSchema, PingResponseSchema } from "../../schemas";
import { agentRequest, type ArmedOverrideOptions, type RequestContext } from "../transport";
import { configWriteFailure } from "@/lib/agent/config-write";
import { setConfigValue } from "./config";

/**
 * Enumerate the serial devices the agent's MAVLink router can bind as the
 * FC link (`GET /api/mavlink/ports`). Returns `[]` only on agents that predate
 * the endpoint (404). Any other failure (timeout, auth, relay 504) throws so
 * the picker can say it could not list ports instead of claiming none exist.
 */
export async function getMavlinkPorts(
  ctx: RequestContext,
): Promise<MavlinkPort[]> {
  try {
    const res = await agentRequest<{ ports: MavlinkPort[] }>(
      ctx,
      "/api/mavlink/ports",
      {
        schema: MavlinkPortsResponseSchema as z.ZodType<{ ports: MavlinkPort[] }>,
        allowSchemaFallback: true,
      },
    );
    return Array.isArray(res.ports) ? res.ports : [];
  } catch (err) {
    if (err instanceof Error && /Agent API 404/.test(err.message)) return [];
    throw err;
  }
}

/**
 * Point the MAVLink router at a chosen FC source. Writes the `mavlink.source`
 * enum and, for a fixed serial source, the `serial_port` / `baud_rate`, all
 * through the existing PUT /api/config surface so the agent's config validator
 * owns the coercion. The caller then watches `mavlink_alive` / `heartbeat_age_s`
 * on the next status poll to confirm a live link.
 *
 * Throws when a write did not land. The agent answers a rejected value with
 * HTTP 200 + `{error}`, and a value it could not write to its config file
 * with HTTP 500 + `persisted: false` — so discarding these results
 * reports an applied FC source the node never stored. The
 * first failure stops the sequence: writing a serial port for a source the
 * node never accepted would leave a half-applied configuration.
 *
 * While the vehicle is armed the agent refuses `mavlink.source` with
 * `AgentArmedRefusal` before anything lands; the caller asks the operator
 * once and calls again with `force`, which carries the override on every key
 * so the whole sequence is resent as a unit.
 */
export async function setMavlinkSource(
  ctx: RequestContext,
  source: FcSource,
  opts?: { serialPort?: string; baudRate?: number } & ArmedOverrideOptions,
): Promise<void> {
  const armed: ArmedOverrideOptions | undefined = opts?.force ? { force: true } : undefined;
  const write = async (key: string, value: string): Promise<void> => {
    const failure = configWriteFailure(await setConfigValue(ctx, key, value, armed));
    if (failure) throw new Error(failure);
  };
  await write("mavlink.source", source);
  if (source === "serial") {
    if (opts?.serialPort) await write("mavlink.serial_port", opts.serialPort);
    if (typeof opts?.baudRate === "number") {
      await write("mavlink.baud_rate", String(opts.baudRate));
    }
  }
}

/**
 * Measure the control-plane round-trip time to the agent. Hits the lightweight
 * `GET /api/ping` echo and times it with `performance.now()`. The returned
 * `rttMs` is the wall-clock RTT; `pong` is the server epoch ms the agent
 * stamped (handed back so callers can derive a clock offset if they want).
 * Returns null on agents that predate `/api/ping` or any transient failure.
 */
export async function pingAgent(
  ctx: RequestContext,
): Promise<{ rttMs: number; pong: number } | null> {
  const started =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const res = await agentRequest<{ pong: number }>(ctx, "/api/ping", {
      schema: PingResponseSchema as z.ZodType<{ pong: number }>,
      allowSchemaFallback: true,
    });
    const ended =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    return { rttMs: Math.max(0, Math.round(ended - started)), pong: res.pong };
  } catch {
    return null;
  }
}
