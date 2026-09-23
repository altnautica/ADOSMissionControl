/**
 * @module LanPairAtlasRoute
 * @description Server-side proxy for a drone agent's Atlas capture-control
 * surface (`/api/atlas/*` on the ados-control front, `:8080`). Sibling to the
 * pairing / vision / compute proxy routes (local-first): lets an HTTPS
 * Mission Control reach a plain-HTTP LAN agent without tripping the browser's
 * mixed-content guard, and resolves `*.local` server-side.
 *
 * The browser POSTs `{ host, apiKey, path, method, body }`. Unlike the compute
 * proxy this keeps the host's own port (`:8080` — Atlas is on the control front,
 * not the engine's `:8092`) and permits PUT (for `PUT /api/atlas/config`). The
 * request is forwarded with the `X-ADOS-Key` header and the upstream status +
 * JSON body are relayed unchanged (see `../_proxy`) so the client coerces the
 * agent's response (and sees a real `503` from a down capture service) with no
 * translation. `path` is checked segment by segment and can only name
 * something under `/api/atlas/`.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import {
  checkAgentHost,
  isSafeSubPath,
  proxyError,
  proxyToAgent,
  readJsonEnvelope,
} from "../_proxy";
import { AGENT_SERVICE_RESTART_TIMEOUT_MS } from "@/lib/agent/agent-client/timeout";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 12000;

export async function POST(req: NextRequest) {
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const { payload } = env;
  const host = checkAgentHost(payload.host);
  if ("reject" in host) return host.reject;

  // Sub-path under /api/atlas/: plain segments only (no %, dot or empty
  // segment), so it can never leave that prefix.
  if (!isSafeSubPath(payload.path)) {
    return proxyError(
      400,
      "bad_path",
      "path must be plain segments under /api/atlas/",
    );
  }

  const method = String(payload.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "PUT") {
    return proxyError(400, "bad_method", "Only GET, POST and PUT are supported");
  }

  const hasBody =
    method !== "GET" && payload.body !== undefined && payload.body !== null;

  // Resolved to IPv4 first so a .local host doesn't stall ~5 s on the AAAA
  // lookup; the host's own :8080 port is kept (../_ipv4).
  return proxyToAgent({
    target: host.target,
    path: `/api/atlas/${payload.path}`,
    method,
    apiKey: String(payload.apiKey ?? "").trim(),
    json: hasBody ? payload.body : undefined,
    // A config write restarts the capture service before the agent answers.
    timeoutMs:
      method === "PUT" && payload.path === "config"
        ? AGENT_SERVICE_RESTART_TIMEOUT_MS
        : UPSTREAM_TIMEOUT_MS,
  });
}
