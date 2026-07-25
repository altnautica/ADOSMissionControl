/**
 * @module agent/agent-client/system
 * @description Status / telemetry / services / system / logs / params
 * / generic command surface. Pure async functions that take a request
 * context; the AgentClient class re-exposes them as instance methods.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import { normalizeServiceStatus } from "../service-state";
import type {
  AgentStatus,
  CommandResult,
  FcSource,
  FullStatusResponse,
  LogEntry,
  MavlinkPort,
  ServiceInfo,
  SystemResources,
  TelemetrySnapshot,
} from "../types";
import {
  AgentStatusSchema,
  CommandResultSchema,
  FullStatusResponseSchema,
  MavlinkPortsResponseSchema,
  PingResponseSchema,
  ServicesResponseSchema,
  SystemResourcesRawSchema,
  TelemetrySnapshotSchema,
} from "../schemas";
import { agentRequest, type RequestContext } from "./transport";
import { agentSupports, fetchVersionInfo } from "./version-cache";

/** A finite number, or undefined when the field is absent or unparseable.
 * `Number(undefined ?? 0)` would report a missing reading as 0, which reads on
 * a gauge as "idle" or "empty" instead of "not reported". */
function optionalNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Coerce a raw `/api/system` (or partial consolidated `/api/status/full`)
 * response into the canonical `SystemResources` shape. A reading the agent
 * did not send stays undefined so the gauge renders it as unknown.
 *
 * The agent surfaces temperature in two shapes: `{ temperature: 45.2 }`
 * (consolidated endpoint) or `{ temperatures: { cpu_thermal: 45.2 } }`
 * (per-domain endpoint). Both are normalised to the flat `temperature`
 * field; falls back to `null` when neither is present.
 */
export function normaliseSystemResources(
  res: Record<string, unknown>,
): SystemResources {
  let temperature: number | null = null;
  if (res.temperature != null) {
    temperature = Number(res.temperature);
  } else if (res.temperatures && typeof res.temperatures === "object") {
    const temps = res.temperatures as Record<string, number>;
    temperature = temps.cpu_thermal ?? Object.values(temps)[0] ?? null;
  }
  // Utilisation and capacity readings preserve absence: a node that reported
  // no figure is unknown, not idle and not empty. The swap and memory-detail
  // fields keep their documented 0 default, where 0 is a real reading (no swap
  // configured, no cache held) rather than a stand-in for a missing one.
  return {
    cpu_percent: optionalNumber(res.cpu_percent),
    memory_percent: optionalNumber(res.memory_percent),
    memory_used_mb: optionalNumber(res.memory_used_mb),
    memory_total_mb: optionalNumber(res.memory_total_mb),
    memory_available_mb: Number(res.memory_available_mb ?? 0),
    memory_cache_mb: Number(res.memory_cache_mb ?? 0),
    swap_total_mb: Number(res.swap_total_mb ?? 0),
    swap_used_mb: Number(res.swap_used_mb ?? 0),
    swap_percent: Number(res.swap_percent ?? 0),
    disk_percent: optionalNumber(res.disk_percent),
    disk_used_gb: optionalNumber(res.disk_used_gb),
    disk_total_gb: optionalNumber(res.disk_total_gb),
    temperature,
  };
}

export async function getStatus(ctx: RequestContext): Promise<AgentStatus> {
  const status = await agentRequest<AgentStatus>(ctx, "/api/status", {
    schema: AgentStatusSchema as z.ZodType<AgentStatus>,
    allowSchemaFallback: true,
  });
  // The non-full /api/status route emits the FC-liveness fields in camelCase
  // too, so the initial-connect render + the getFullStatus-null fallback carry
  // the gated truth + hint instead of degrading to a bare fc_connected.
  return { ...status, ...snakeLivenessPatch(status) };
}

export function getTelemetry(ctx: RequestContext): Promise<TelemetrySnapshot> {
  return agentRequest<TelemetrySnapshot>(ctx, "/api/telemetry", {
    schema: TelemetrySnapshotSchema as z.ZodType<TelemetrySnapshot>,
    allowSchemaFallback: true,
  });
}

export async function getServices(
  ctx: RequestContext,
  agentUptimeHint?: number,
): Promise<ServiceInfo[]> {
  const svcRes = await agentRequest<
    Array<Record<string, unknown>> | { services: Array<Record<string, unknown>> }
  >(ctx, "/api/services", {
    schema: ServicesResponseSchema as z.ZodType<
      Array<Record<string, unknown>> | { services: Array<Record<string, unknown>> }
    >,
    allowSchemaFallback: true,
  });
  const list = Array.isArray(svcRes) ? svcRes : (svcRes.services ?? []);

  // Compute per-service uptime from monotonic last_transition timestamps.
  // Use agent uptime hint (from store) to estimate current monotonic time.
  const agentUptime = agentUptimeHint ?? 0;
  const transitions = list
    .map((s) => (typeof s.last_transition === "number" ? s.last_transition : 0))
    .filter((t) => t > 0);
  const earliestStart = transitions.length > 0 ? Math.min(...transitions) : 0;
  const monotonicNow = earliestStart > 0 ? earliestStart + agentUptime : 0;

  return list.map((s) => {
    const lastTransition = typeof s.last_transition === "number" ? s.last_transition : 0;
    const uptimeSeconds = monotonicNow > 0 && lastTransition > 0
      ? Math.max(0, monotonicNow - lastTransition)
      : (typeof s.uptime_seconds === "number" ? s.uptime_seconds : 0);

    return {
      name: String(s.name ?? "unknown"),
      status: normalizeServiceStatus(s),
      pid: typeof s.pid === "number" ? s.pid : null,
      cpu_percent:
        typeof s.cpu_percent === "number"
          ? s.cpu_percent
          : (typeof s.cpuPercent === "number" ? s.cpuPercent : 0),
      memory_mb:
        typeof s.memory_mb === "number"
          ? s.memory_mb
          : (typeof s.memoryMb === "number" ? s.memoryMb : 0),
      uptime_seconds: uptimeSeconds,
    };
  });
}

export async function getSystemResources(
  ctx: RequestContext,
): Promise<SystemResources> {
  const res = await agentRequest<Record<string, unknown>>(ctx, "/api/system", {
    schema: SystemResourcesRawSchema as z.ZodType<Record<string, unknown>>,
    allowSchemaFallback: true,
  });
  return normaliseSystemResources(res);
}

export async function getLogs(
  ctx: RequestContext,
  params?: { level?: string; limit?: number },
): Promise<LogEntry[]> {
  const qs = new URLSearchParams();
  if (params?.level) qs.set("level", params.level);
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  const res = await agentRequest<LogEntry[] | { entries: LogEntry[] }>(
    ctx,
    `/api/logs${query ? `?${query}` : ""}`,
  );
  return Array.isArray(res) ? res : (res.entries ?? []);
}

export function getParams(
  ctx: RequestContext,
): Promise<Record<string, number>> {
  return agentRequest<Record<string, number>>(ctx, "/api/params");
}

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
  const resultName =
    typeof block.result_name === "string" && block.result_name.length > 0
      ? block.result_name
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

export function getConfig(ctx: RequestContext): Promise<Record<string, unknown>> {
  return agentRequest<Record<string, unknown>>(ctx, "/api/config");
}

/**
 * Write a single config value via the agent's PUT /api/config endpoint.
 * Dot-separated key paths are supported by the agent
 * (e.g. `ground_station.display.type`). The agent coerces the string
 * value to the underlying field type at the Pydantic boundary, so the
 * caller hands in a plain string. Returns the {key, value} echo the
 * agent sends back so the UI can confirm the round-trip.
 */
export function setConfigValue(
  ctx: RequestContext,
  key: string,
  value: string,
): Promise<{ status?: string; key?: string; value?: unknown; error?: string }> {
  return agentRequest<{
    status?: string;
    key?: string;
    value?: unknown;
    error?: string;
  }>(ctx, "/api/config", {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  });
}

export function restartService(
  ctx: RequestContext,
  name: string,
): Promise<CommandResult> {
  return agentRequest<CommandResult>(
    ctx,
    `/api/services/${encodeURIComponent(name)}/restart`,
    {
      method: "POST",
      schema: CommandResultSchema as z.ZodType<CommandResult>,
    },
  );
}

/**
 * Fetch all status data in a single request (agent v0.3.19+).
 * Falls back to null on older agents that don't have this endpoint.
 *
 * Uses /api/version capability negotiation when available so we
 * skip the request entirely (and don't burn a 404 round-trip)
 * against an agent that hasn't advertised status.full.
 */
/** The five FC-liveness fields the agent emits in camelCase but the GCS reads
 * in snake_case. Both `AgentStatus` and `FullStatusResponse` carry them as
 * optional snake fields. */
interface SnakeLiveness {
  transport_open?: boolean;
  mavlink_alive?: boolean;
  heartbeat_age_s?: number | null;
  fc_source?: FcSource;
  fc_link_hint?: string;
  fc_firmware?: string;
  fc_variant?: string;
  fc_reachable?: boolean;
}

/**
 * The agent's native status front emits the FC-liveness detail in camelCase
 * (`transportOpen` / `mavlinkAlive` / `heartbeatAgeS` / `fcSource` / `fcLinkHint`,
 * "like the heartbeat"), while the rest of the GCS reads these as snake_case off
 * `AgentStatus` / `FullStatusResponse`. Bridge the two at the LAN boundary: when
 * a snake field is absent but its camelCase sibling is present, copy it across
 * (snake wins for back-compat). Without this the gated MAVLink truth + the
 * FC-link diagnostic hint silently never reach the LAN-direct render path, so a
 * port-open-but-silent link reads as a bare disconnect with no remediation.
 * Returns just the five fields so callers spread it over the source object.
 */
function snakeLivenessPatch(obj: SnakeLiveness): SnakeLiveness {
  const raw = obj as unknown as Record<string, unknown>;
  const bool = (snake: boolean | undefined, camel: unknown) =>
    typeof snake === "boolean"
      ? snake
      : typeof camel === "boolean"
        ? camel
        : snake;
  const str = (snake: string | undefined, camel: unknown) =>
    typeof snake === "string" ? snake : typeof camel === "string" ? camel : snake;
  const numOrNull = (
    snake: number | null | undefined,
    camel: unknown,
  ): number | null | undefined =>
    snake !== undefined
      ? snake
      : camel === null || typeof camel === "number"
        ? (camel as number | null)
        : snake;
  return {
    transport_open: bool(obj.transport_open, raw.transportOpen),
    mavlink_alive: bool(obj.mavlink_alive, raw.mavlinkAlive),
    heartbeat_age_s: numOrNull(obj.heartbeat_age_s, raw.heartbeatAgeS),
    fc_source: str(obj.fc_source, raw.fcSource) as FcSource | undefined,
    fc_link_hint: str(obj.fc_link_hint, raw.fcLinkHint),
    // The native front emits the FC firmware family in camelCase
    // (`fcFirmware`); bridge it to the snake `fc_firmware` the GCS reads so a
    // LAN-direct ArduPilot/PX4 node names its firmware the same as the cloud.
    fc_firmware: str(obj.fc_firmware, raw.fcFirmware),
    // The protocol family and the agent's own connected-or-reachable verdict.
    // Without these a healthy MSP flight controller (which never emits the
    // MAVLink heartbeat `fc_connected` gates on) reads as absent on the
    // LAN-direct path, and the FC surfaces claim "no flight controller".
    fc_variant: str(obj.fc_variant, raw.fcVariant),
    fc_reachable: bool(obj.fc_reachable, raw.fcReachable),
  };
}

/** Bridge the camelCase liveness on a `/api/status/full` response into the
 * snake_case the GCS reads. Exported for the LAN boundary + tests. */
export function normalizeFullStatusLiveness(
  full: FullStatusResponse,
): FullStatusResponse {
  return { ...full, ...snakeLivenessPatch(full) };
}

export async function getFullStatus(
  ctx: RequestContext,
): Promise<FullStatusResponse | null> {
  const info = await fetchVersionInfo(ctx);
  if (info && !agentSupports(info, "status.full")) {
    return null;
  }
  try {
    const full = await agentRequest<FullStatusResponse>(ctx, "/api/status/full", {
      schema: FullStatusResponseSchema as z.ZodType<FullStatusResponse>,
      allowSchemaFallback: true,
    });
    return normalizeFullStatusLiveness(full);
  } catch {
    return null; // Agent version older than 0.3.19, or transient failure
  }
}

/**
 * Enumerate the serial devices the agent's MAVLink router can bind as the
 * FC link (`GET /api/mavlink/ports`). Returns `[]` on agents that predate the
 * endpoint (or any transient failure) so the picker degrades to "no ports
 * detected" rather than throwing.
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
  } catch {
    return [];
  }
}

/**
 * Point the MAVLink router at a chosen FC source. Writes the `mavlink.source`
 * enum and, for a fixed serial source, the `serial_port` / `baud_rate`, all
 * through the existing PUT /api/config surface so the agent's config validator
 * owns the coercion. The caller then watches `mavlink_alive` / `heartbeat_age_s`
 * on the next status poll to confirm a live link.
 */
export async function setMavlinkSource(
  ctx: RequestContext,
  source: FcSource,
  opts?: { serialPort?: string; baudRate?: number },
): Promise<void> {
  await setConfigValue(ctx, "mavlink.source", source);
  if (source === "serial") {
    if (opts?.serialPort) {
      await setConfigValue(ctx, "mavlink.serial_port", opts.serialPort);
    }
    if (typeof opts?.baudRate === "number") {
      await setConfigValue(ctx, "mavlink.baud_rate", String(opts.baudRate));
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
