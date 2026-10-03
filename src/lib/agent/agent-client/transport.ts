/**
 * @module agent/agent-client/transport
 * @description Shared fetch wrapper for the agent REST surface. Adds
 * the X-ADOS-Key header, applies an optional Zod schema with a
 * dev-mode-only fallback when the agent's response shape drifts ahead
 * of the client.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import { AGENT_FETCH_TIMEOUT_MS, withTimeoutSignal } from "./timeout";

export interface RequestContext {
  baseUrl: string;
  apiKey: string | null;
  /** True when `baseUrl` is a ground station's relay-proxy prefix rather than
   *  the agent's own origin. Callers that port-swap or assume a bare origin
   *  must branch on it — only `:8080/api/...` traverses the radio relay. */
  relay?: boolean;
  /** Overrides `AGENT_FETCH_TIMEOUT_MS` for every request on this client.
   *  A per-request `timeoutMs` still wins. */
  defaultTimeoutMs?: number;
}

export interface RequestOptions<T> extends Omit<RequestInit, "body"> {
  body?: BodyInit | null;
  schema?: z.ZodType<T>;
  allowSchemaFallback?: boolean;
  /** Per-request deadline. Defaults to `AGENT_FETCH_TIMEOUT_MS`. Pass a
   * larger value for slow writes/commands; a caller-supplied `signal`
   * is honoured alongside the timeout. */
  timeoutMs?: number;
}

/**
 * A non-2xx answer FROM the agent, as distinct from never reaching it.
 *
 * The message is unchanged (`Agent API <status>: <body>`) because several
 * callers regex it, but `status` lets a caller tell "this agent does not
 * have this endpoint" (404/501 — durable) from "the request never landed"
 * (abort, DNS, refused connection — transient). Caching those two the same
 * way is how a single bring-up glitch pinned an agent's capability set to
 * empty for five minutes.
 */
export class AgentHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Agent API ${status}: ${body}`);
    this.name = "AgentHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * The agent refused a flight-affecting action because the vehicle is armed
 * (HTTP 409, `{"error":"E_ARMED","override":"force"}`). The same request
 * carrying the override (`"force": true` in a JSON body, `?force=1` on a
 * bodiless call) is accepted; `useArmedOverrideConfirm` asks the operator
 * before sending it.
 */
export class AgentArmedRefusal extends AgentHttpError {
  constructor(body: string) {
    super(409, body);
    this.name = "AgentArmedRefusal";
  }
}

/** An armed refusal when a non-2xx answer is a 409 naming `E_ARMED`, else
 * null. Shared by `agentRequest` and the ground-station `gsRequest`. */
export function armedRefusalFrom(status: number, body: string): AgentArmedRefusal | null {
  if (status !== 409) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed === "object" && parsed !== null && "error" in parsed && parsed.error === "E_ARMED") {
    return new AgentArmedRefusal(body);
  }
  return null;
}

/** The armed-override options every flight-affecting client call accepts. */
export interface ArmedOverrideOptions {
  force?: boolean;
}

/** Append `force=1` to a bodiless request's path when the override is set. */
export function withForceQuery(path: string, opts?: ArmedOverrideOptions): string {
  if (!opts?.force) return path;
  return `${path}${path.includes("?") ? "&" : "?"}force=1`;
}

/** The reasons a drone (or the relaying ground station) refuses a relay
 * ticket, as carried in `{"error":"E_RELAY_TICKET","reason":…}`. */
export const RELAY_TICKET_REASONS = [
  "expired",
  "clock_skew",
  "replayed",
  "bad_signature",
  "binding_mismatch",
  "no_secret",
  "secret_conflict",
] as const;
export type RelayTicketReason = (typeof RELAY_TICKET_REASONS)[number];

/** Why a call over a ground station's relay-proxy was refused: the relay
 * ticket itself (`ticket`), or the drone's own API failing behind a working
 * relay (`peerApi`, `{"error":"E_RELAY_PEER_API"}`). */
export type RelayRefusal =
  | { kind: "ticket"; reason: RelayTicketReason | "unknown" }
  | { kind: "peerApi"; detail: string | null };

/** The relay refusal an agent error carries, or null for any other failure. */
export function relayRefusalFrom(err: unknown): RelayRefusal | null {
  if (!(err instanceof AgentHttpError)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(err.body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("error" in parsed)) return null;
  if (parsed.error === "E_RELAY_TICKET") {
    const raw = "reason" in parsed ? parsed.reason : undefined;
    const reason = RELAY_TICKET_REASONS.find((r) => r === raw) ?? "unknown";
    return { kind: "ticket", reason };
  }
  if (parsed.error === "E_RELAY_PEER_API") {
    const detail = "detail" in parsed && typeof parsed.detail === "string" ? parsed.detail : null;
    return { kind: "peerApi", detail };
  }
  return null;
}

export async function agentRequest<T>(
  ctx: RequestContext,
  path: string,
  init?: RequestOptions<T>,
): Promise<T> {
  const {
    schema,
    allowSchemaFallback = false,
    timeoutMs = ctx.defaultTimeoutMs ?? AGENT_FETCH_TIMEOUT_MS,
    signal,
    ...fetchInit
  } = init ?? {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchInit?.headers as Record<string, string>),
  };
  if (ctx.apiKey) {
    headers["X-ADOS-Key"] = ctx.apiKey;
  }
  // A half-open socket would otherwise hang this fetch for the browser
  // default (~minutes), which freezes the poll loop and defeats the
  // disconnect watchdog. Bound every request with a deadline.
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    ...fetchInit,
    headers,
    signal: withTimeoutSignal(timeoutMs, signal ?? null),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw armedRefusalFrom(res.status, text) ?? new AgentHttpError(res.status, text);
  }
  const json = (await res.json()) as unknown;
  if (schema) {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      if (allowSchemaFallback && process.env.NODE_ENV !== "production") {
        console.warn(
          `[agent-client] schema mismatch on ${path}:`,
          parsed.error.flatten(),
        );
      }
      if (allowSchemaFallback) {
        return json as T;
      }
      throw new Error(`Agent API schema mismatch on ${path}`);
    }
    return parsed.data as T;
  }
  return json as T;
}
