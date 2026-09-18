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
    throw new AgentHttpError(res.status, text);
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
