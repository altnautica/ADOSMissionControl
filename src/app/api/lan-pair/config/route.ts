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
 * `POST` targets the setup apply endpoint. The upstream JSON body and status
 * are returned unchanged (see `../_proxy`) so the client maps the agent's response — including
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

import type { NextRequest } from "next/server";
import {
  checkAgentHost,
  proxyError,
  proxyToAgent,
  readJsonEnvelope,
} from "../_proxy";
import { isValidPeerDeviceId } from "../_peer-device-id";
import {
  CONFIG_PROXY_RELAY_UPSTREAM_TIMEOUT_MS,
  CONFIG_PROXY_UPSTREAM_TIMEOUT_MS,
} from "@/lib/agent/config-proxy-budget";

export const runtime = "nodejs";

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
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const { payload } = env;
  const host = checkAgentHost(payload.host);
  if ("reject" in host) return host.reject;

  const method = String(payload.method ?? "GET").toUpperCase();
  if (!isProxyMethod(method)) {
    return proxyError(400, "bad_method", "Only GET, PUT and POST are supported");
  }

  // Writes carry a JSON object body (`{key, value}` for the config PUT, a
  // partial setup update for the apply POST). Reject a missing / non-object
  // body here so a malformed envelope never reaches the agent.
  const hasBody = method !== "GET";
  if (
    hasBody &&
    (payload.body === undefined ||
      payload.body === null ||
      typeof payload.body !== "object" ||
      Array.isArray(payload.body))
  ) {
    return proxyError(400, "bad_body", "A JSON object body is required");
  }

  // A `peerDeviceId` KEY selects the relay lane, whatever its value: an
  // envelope that meant to relay and lost its peer id must be a 400 here, not
  // a silent downgrade to a LAN call — that would read the GROUND STATION's
  // own config and label it as the drone's. JSON drops `undefined` keys, so
  // the only values that reach here are a real string or a bad one.
  const peerDeviceId = payload.peerDeviceId;
  if (peerDeviceId !== undefined && !isValidPeerDeviceId(peerDeviceId)) {
    return proxyError(
      400,
      "bad_peer_device_id",
      "peerDeviceId must be a device id (letters, digits, dot, dash, underscore; 32 chars max)",
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

  // Resolved to IPv4 first so a .local host doesn't stall on AAAA (../_ipv4).
  return proxyToAgent({
    target: host.target,
    path: upstreamPath,
    method,
    apiKey: String(payload.apiKey ?? "").trim(),
    json: hasBody ? payload.body : undefined,
    timeoutMs: isRelay
      ? CONFIG_PROXY_RELAY_UPSTREAM_TIMEOUT_MS
      : CONFIG_PROXY_UPSTREAM_TIMEOUT_MS,
  });
}
