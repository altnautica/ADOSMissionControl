/**
 * @module LanPairWorkstationCredentialRoute
 * @description Server-side proxy for a node's workstation-credential surface
 * (`/api/compute/workstation-credential` on the ados-control front, `:8080`):
 * installing the credential a workstation issued the node, and listing what is
 * installed. Sibling to the atlas / compute proxy routes (local-first): lets an
 * HTTPS Mission Control reach a plain-HTTP LAN agent without tripping the
 * browser's mixed-content guard, and resolves `*.local` server-side.
 *
 * The browser POSTs `{ host, apiKey, method, body }`. The upstream path is
 * fixed (the caller names no path), the host's own `:8080` port is kept, and the
 * request is forwarded with the `X-ADOS-Key` header. The upstream status + JSON
 * body are relayed unchanged (see `../_proxy`).
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

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 12000;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const { payload } = env;
  const host = checkAgentHost(payload.host);
  if ("reject" in host) return host.reject;

  const method = String(payload.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return proxyError(400, "bad_method", "Only GET and POST are supported");
  }
  const hasBody =
    method === "POST" && payload.body !== undefined && payload.body !== null;

  return proxyToAgent({
    target: host.target,
    path: "/api/compute/workstation-credential",
    method,
    apiKey: String(payload.apiKey ?? "").trim(),
    json: hasBody ? payload.body : undefined,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
