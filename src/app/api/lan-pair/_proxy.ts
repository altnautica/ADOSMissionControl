/**
 * @module LanPairProxy
 * @description The one request/response core every `/api/lan-pair/*` proxy
 * route runs through. A route declares its fixed upstream path, method and
 * timeout; this module owns everything security-relevant around that:
 *
 *  - **Caller gate.** A proxy call must come from a page on this origin: the
 *    `Origin` header is required and its host must equal the host the request
 *    was addressed to. A JSON envelope must also declare
 *    `Content-Type: application/json` (a cross-site `<form>` can only send
 *    `text/plain`, urlencoded or multipart, and cannot set `Origin`).
 *  - **Target gate.** The host must pass `normaliseAndCheckHost` (private /
 *    mDNS / loopback / tailnet only), use one of the agent's own ports, and
 *    resolve to a private IPv4 address server-side. A name that fails to
 *    resolve is refused rather than handed to `fetch` to resolve on its own.
 *  - **Path gate.** Caller-supplied sub-paths are checked segment by segment
 *    (no `%`, no dot segment, no empty segment), and the composed upstream
 *    URL must parse to exactly the path that was built, so URL normalisation
 *    can never move the request somewhere else.
 *  - **Response.** Always `application/json` with `nosniff` and a sandbox CSP.
 *    The upstream body is passed through only when it parses as JSON;
 *    redirects are not followed and bodies are size-capped.
 *
 * Co-located under the route folder with a leading underscore so it is never
 * treated as a route.
 *
 * @license GPL-3.0-only
 */

import { NextResponse } from "next/server";
import { normaliseAndCheckHost } from "@/lib/agent/host-validation";
import { agentFetchBase } from "./_ipv4";

/** The only ports a proxy call may target: the agent's control front and the
 * compute engine's job listener. */
const AGENT_PORTS: ReadonlySet<number> = new Set([8080, 8092]);

/** Largest upstream body relayed back. Agent JSON replies are kilobytes. */
const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;

/** Headers on every response this proxy produces, success or refusal. */
const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json",
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox",
  "cache-control": "no-store",
};

/** One path segment: unreserved URL characters only, so nothing in it can be
 * percent-decoded, and nothing can act as a separator, query or fragment. */
const SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;

export type Refusal = { reject: NextResponse };

export interface AgentTarget {
  url: string;
  host: string;
  port: number;
}

/** A JSON error body with the proxy's fixed response headers. */
export function proxyError(
  status: number,
  error: string,
  message: string,
): NextResponse {
  return new NextResponse(JSON.stringify({ error, message }), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function refuse(status: number, error: string, message: string): Refusal {
  return { reject: proxyError(status, error, message) };
}

/** The host the browser addressed. A fronting proxy reports it in
 * `X-Forwarded-Host`; otherwise it is the `Host` header. */
function addressedHost(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || req.headers.get("host") || new URL(req.url).host;
  return host.toLowerCase();
}

/** Refuse a request that did not come from a page on this origin. */
export function checkSameOrigin(req: Request): Refusal | null {
  const origin = req.headers.get("origin");
  if (!origin) {
    return refuse(403, "origin_required", "Origin header is required");
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return refuse(403, "cross_origin", "Origin is not this site");
  }
  if (!originHost || originHost !== addressedHost(req)) {
    return refuse(403, "cross_origin", "Origin is not this site");
  }
  return null;
}

function mediaType(req: Request): string {
  return (req.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

/** Gate and parse a JSON envelope: same origin, `application/json`, and a
 * JSON object body. */
export async function readJsonEnvelope(
  req: Request,
): Promise<{ payload: Record<string, unknown> } | Refusal> {
  const cross = checkSameOrigin(req);
  if (cross) return cross;
  if (mediaType(req) !== "application/json") {
    return refuse(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json",
    );
  }
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return refuse(400, "bad_json", "Request body must be JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse(400, "bad_json", "Request body must be a JSON object");
  }
  return { payload: parsed as Record<string, unknown> };
}

/** Gate and parse a multipart envelope (the model upload): same origin,
 * `multipart/form-data`, and a declared `Content-Length` no larger than
 * `maxBytes`. The length is required so the body is bounded before it is
 * buffered: the HTTP parser never delivers more bytes than it declares, and a
 * chunked body (no length) is refused outright. */
export async function readFormEnvelope(
  req: Request,
  maxBytes: number,
): Promise<{ form: FormData } | Refusal> {
  const cross = checkSameOrigin(req);
  if (cross) return cross;
  if (mediaType(req) !== "multipart/form-data") {
    return refuse(
      415,
      "unsupported_media_type",
      "Content-Type must be multipart/form-data",
    );
  }
  const declared = req.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared.trim())) {
    return refuse(411, "length_required", "Content-Length is required");
  }
  if (Number(declared) > maxBytes) {
    return refuse(
      413,
      "body_too_large",
      `The upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit`,
    );
  }
  try {
    return { form: await req.formData() };
  } catch {
    return refuse(400, "bad_form", "Request body must be multipart/form-data");
  }
}

/** Validate the caller's host: private address class and an agent port. */
export function checkAgentHost(raw: unknown): { target: AgentTarget } | Refusal {
  const target = normaliseAndCheckHost(typeof raw === "string" ? raw : "");
  if ("error" in target) {
    return refuse(400, target.error ?? "bad_host", target.message ?? "");
  }
  if (!AGENT_PORTS.has(target.port)) {
    return refuse(
      400,
      "port_not_allowed",
      "Only the agent ports 8080 and 8092 are allowed",
    );
  }
  return { target };
}

/** True when `raw` is a relative sub-path of plain segments: no `%`, no `.`
 * or `..` segment, no empty segment (so no leading, trailing or doubled
 * slash), no query or fragment. */
export function isSafeSubPath(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return false;
  }
  return raw
    .split("/")
    .every((seg) => SEGMENT_RE.test(seg) && seg !== "." && seg !== "..");
}

/** Percent-encode one identity value as a single path segment, or null when
 * it is empty or would read as a dot segment. */
export function encodeSegment(value: string): string | null {
  if (!value || value === "." || value === "..") return null;
  return encodeURIComponent(value);
}

export interface AgentCall {
  target: AgentTarget;
  /** Absolute upstream path, composed server-side from fixed parts. */
  path: string;
  method: "GET" | "POST" | "PUT";
  timeoutMs: number;
  apiKey?: string;
  /** Serialised as the JSON request body when defined. */
  json?: unknown;
  /** Sent as a multipart body. */
  form?: FormData;
  /** Pin the upstream port (the compute engine's own listener). */
  port?: number;
  /** Message for a transport failure; defaults to the error text. */
  unreachableMessage?: string;
}

/** An upstream answer whose body parsed as JSON (`value` undefined and
 * `text` null when the body was empty). */
export interface AgentReply {
  status: number;
  text: string | null;
  value: unknown;
}

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPSTREAM_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Resolve the upstream origin and build the exact URL, refusing anything
 * URL parsing would rewrite. */
export async function agentUrl(
  target: AgentTarget,
  path: string,
  port?: number,
): Promise<string | Refusal> {
  const base = await agentFetchBase(target, port);
  if (!base) {
    return refuse(
      502,
      "host_unresolved",
      "The host did not resolve to a private IPv4 address",
    );
  }
  const url = `${base}${path}`;
  const parsed = new URL(url);
  if (parsed.origin !== base || parsed.pathname !== path.split("?")[0]) {
    return refuse(400, "bad_path", "Upstream path failed validation");
  }
  return url;
}

/** Make the upstream call and read a JSON answer. */
export async function callAgent(call: AgentCall): Promise<AgentReply | Refusal> {
  try {
    const url = await agentUrl(call.target, call.path, call.port);
    if (typeof url !== "string") return url;
    const hasJson = call.json !== undefined;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(hasJson ? { "Content-Type": "application/json" } : {}),
      ...(call.apiKey ? { "X-ADOS-Key": call.apiKey } : {}),
    };
    const upstream = await fetch(url, {
      method: call.method,
      headers,
      body: hasJson ? JSON.stringify(call.json) : call.form,
      redirect: "manual",
      signal: AbortSignal.timeout(call.timeoutMs),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return refuse(502, "upstream_redirect", "The agent answered with a redirect");
    }
    const text = await readCapped(upstream);
    if (text === null) {
      return refuse(502, "upstream_too_large", "The agent's answer was too large");
    }
    if (text.trim() === "") {
      return { status: upstream.status, text: null, value: undefined };
    }
    try {
      return { status: upstream.status, text, value: JSON.parse(text) as unknown };
    } catch {
      return refuse(
        upstream.ok ? 502 : upstream.status,
        "upstream_not_json",
        `The agent answered HTTP ${upstream.status} with a non-JSON body`,
      );
    }
  } catch (e) {
    return refuse(
      502,
      "upstream_unreachable",
      call.unreachableMessage ?? (e instanceof Error ? e.message : String(e)),
    );
  }
}

/** Relay a JSON answer: the upstream status, and its body verbatim. */
export function relayReply(reply: AgentReply): NextResponse {
  const noBody = reply.text === null || reply.status === 204 || reply.status === 205;
  return new NextResponse(noBody ? null : reply.text, {
    status: reply.status,
    headers: RESPONSE_HEADERS,
  });
}

/** A JSON value the route built itself, with the proxy's response headers. */
export function jsonReply(status: number, value: unknown): NextResponse {
  return new NextResponse(JSON.stringify(value), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

/** `callAgent` then `relayReply`: the whole proxy hop for most routes. */
export async function proxyToAgent(call: AgentCall): Promise<NextResponse> {
  const reply = await callAgent(call);
  return "reject" in reply ? reply.reject : relayReply(reply);
}
