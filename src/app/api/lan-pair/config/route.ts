/**
 * @module LanPairConfigRoute
 * @description Server-side proxy for the LAN agent's configuration
 * surface: `GET /api/config` (the redacted config read), `PUT /api/config`
 * (the single-key write), and the batch setup apply
 * (`POST /api/v1/setup/apply`). Sibling to the pairing / vision-detector
 * proxy routes (local-first): lets an HTTPS Mission Control read and
 * write a plain-HTTP LAN node's configuration without tripping the
 * browser's mixed-content guard, and resolves `*.local` server-side
 * where the OS resolver speaks mDNS.
 *
 * The browser POSTs `{ host, apiKey, method, body }`. `method` selects
 * the upstream call: `GET` and `PUT` target `/api/config`, `POST`
 * targets the setup apply endpoint. The upstream body and status are
 * returned verbatim so the client maps the agent's response — including
 * a 422 validation message or an `{error}` payload — with no extra
 * translation, exactly as a direct LAN call would surface it.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";
import { normaliseAndCheckHost } from "@/lib/agent/host-validation";
import { ipv4FetchBase } from "../_ipv4";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 12000;

/** Upstream paths by envelope method. The mapping is fixed server-side so
 * the proxy can never be steered at an arbitrary agent path. */
const UPSTREAM_PATHS = {
  GET: "/api/config",
  PUT: "/api/config",
  POST: "/api/v1/setup/apply",
} as const;

type ProxyMethod = keyof typeof UPSTREAM_PATHS;

function isProxyMethod(value: string): value is ProxyMethod {
  return value in UPSTREAM_PATHS;
}

export async function POST(req: NextRequest) {
  let payload: {
    host?: string;
    apiKey?: string;
    method?: string;
    body?: unknown;
  };
  try {
    payload = (await req.json()) as {
      host?: string;
      apiKey?: string;
      method?: string;
      body?: unknown;
    };
  } catch {
    return NextResponse.json(
      { error: "bad_json", message: "Request body must be JSON" },
      { status: 400 },
    );
  }

  const target = normaliseAndCheckHost(payload?.host ?? "");
  if ("error" in target) {
    return NextResponse.json(
      { error: target.error, message: target.message },
      { status: 400 },
    );
  }

  const method = String(payload?.method ?? "GET").toUpperCase();
  if (!isProxyMethod(method)) {
    return NextResponse.json(
      { error: "bad_method", message: "Only GET, PUT and POST are supported" },
      { status: 400 },
    );
  }

  // Writes carry a JSON object body (`{key, value}` for the config PUT, a
  // partial setup update for the apply POST). Reject a missing / non-object
  // body here so a malformed envelope never reaches the agent.
  const hasBody = method !== "GET";
  if (
    hasBody &&
    (payload?.body === undefined ||
      payload?.body === null ||
      typeof payload.body !== "object" ||
      Array.isArray(payload.body))
  ) {
    return NextResponse.json(
      { error: "bad_body", message: "A JSON object body is required" },
      { status: 400 },
    );
  }

  const apiKey = String(payload?.apiKey ?? "").trim();

  try {
    // Resolve to IPv4 first so a .local host doesn't stall on AAAA (../_ipv4).
    const base = await ipv4FetchBase(target);
    const upstream = await fetch(`${base}${UPSTREAM_PATHS[method]}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { "X-ADOS-Key": apiKey } : {}),
      },
      body: hasBody ? JSON.stringify(payload.body) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "upstream_unreachable",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
