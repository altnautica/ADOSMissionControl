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
 * The browser POSTs `{ host, apiKey, method, body, peerDeviceId? }`.
 * `method` selects the upstream call: `GET` and `PUT` target `/api/config`,
 * `POST` targets the setup apply endpoint. The upstream body and status are
 * returned verbatim so the client maps the agent's response — including
 * a 422 validation message or an `{error}` payload — with no extra
 * translation, exactly as a direct LAN call would surface it.
 *
 * A `peerDeviceId` selects the RELAY lane: `host` is then a ground station
 * and the upstream is that station's relay-proxy route, which forwards the
 * call to a WFB-linked drone over the aux radio lane. A drone reached only
 * through a relay has no IP address of its own, so this is the only lane its
 * settings surface has. The peer id is the sole variable segment; the
 * `/api/config` suffix stays fixed server-side exactly as on the LAN lane,
 * so the relay lane adds no steerability.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";
import { normaliseAndCheckHost } from "@/lib/agent/host-validation";
import { ipv4FetchBase } from "../_ipv4";
import { isValidPeerDeviceId } from "../_peer-device-id";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 12000;

/** The relay lane crosses a WFB radio, so it gets a longer ceiling than the
 * 12 s LAN value. The ground station's own relay bound is ~10 s (the same
 * reason `AgentClient` raises its client-side default to 15 s for a relay
 * client): a timeout at or below the agent's own bound aborts a legitimately
 * slow-but-successful answer before the agent can report an honest gateway
 * timeout, so a slow radio reads as `upstream_unreachable` — a generic
 * network error — instead of the truth. 15 s sits above the agent's bound and
 * matches the direct relay client, so both lanes fail the same way. */
const RELAY_UPSTREAM_TIMEOUT_MS = 15000;

/** Upstream paths by envelope method. The mapping is fixed server-side so
 * the proxy can never be steered at an arbitrary agent path. */
const UPSTREAM_PATHS = {
  GET: "/api/config",
  PUT: "/api/config",
  POST: "/api/v1/setup/apply",
} as const;

/** The ground station's relay-proxy prefix. The peer device id is appended as
 * the one variable segment, then the same fixed `UPSTREAM_PATHS` suffix — the
 * caller supplies an identity, never a path. */
const RELAY_PROXY_PREFIX = "/api/v1/ground-station/relay-proxy";

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
    peerDeviceId?: unknown;
  };
  try {
    payload = (await req.json()) as {
      host?: string;
      apiKey?: string;
      method?: string;
      body?: unknown;
      peerDeviceId?: unknown;
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

  // A `peerDeviceId` KEY selects the relay lane, whatever its value: an
  // envelope that meant to relay and lost its peer id must be a 400 here, not
  // a silent downgrade to a LAN call — that would read the GROUND STATION's
  // own config and label it as the drone's. JSON drops `undefined` keys, so
  // the only values that reach here are a real string or a bad one.
  const peerDeviceId = payload?.peerDeviceId;
  if (peerDeviceId !== undefined && !isValidPeerDeviceId(peerDeviceId)) {
    return NextResponse.json(
      {
        error: "bad_peer_device_id",
        message:
          "peerDeviceId must be a device id (letters, digits, dot, dash, underscore; 32 chars max)",
      },
      { status: 400 },
    );
  }
  // Past that gate the guard holds exactly when the relay lane was selected,
  // and re-asserting it here is what narrows the segment to a string with no
  // cast.
  const isRelay = isValidPeerDeviceId(peerDeviceId);

  // Composed server-side from the fixed suffix, so the caller contributes an
  // identity and never a path.
  const upstreamPath = isRelay
    ? `${RELAY_PROXY_PREFIX}/${peerDeviceId}${UPSTREAM_PATHS[method]}`
    : UPSTREAM_PATHS[method];

  const apiKey = String(payload?.apiKey ?? "").trim();

  try {
    // Resolve to IPv4 first so a .local host doesn't stall on AAAA (../_ipv4).
    const base = await ipv4FetchBase(target);
    const upstream = await fetch(`${base}${upstreamPath}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { "X-ADOS-Key": apiKey } : {}),
      },
      body: hasBody ? JSON.stringify(payload.body) : undefined,
      signal: AbortSignal.timeout(
        isRelay ? RELAY_UPSTREAM_TIMEOUT_MS : UPSTREAM_TIMEOUT_MS,
      ),
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
