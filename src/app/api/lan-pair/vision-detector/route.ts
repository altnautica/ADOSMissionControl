/**
 * @module LanPairVisionDetectorRoute
 * @description Server-side proxy for the LAN agent's
 * `PUT /api/vision/detector` endpoint. Sibling to the pairing proxy
 * routes (Rule 39 local-first): lets an HTTPS Mission Control set a
 * drone's active detector over the operator's LAN without tripping the
 * browser's mixed-content guard, since the cross-protocol hop happens
 * server-side.
 *
 * The browser POSTs `{ host, apiKey, modelId }`. The server forwards
 * `PUT { model_id }` with the `X-ADOS-Key` header. A JSON body and status
 * are returned unchanged (see `../_proxy`) so the client maps the agent's response without
 * extra translation.
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
  const host = checkAgentHost(env.payload.host);
  if ("reject" in host) return host.reject;

  const modelId = String(env.payload.modelId ?? "").trim();
  if (!modelId) {
    return proxyError(400, "model_id_required", "modelId is required");
  }

  // Resolved to IPv4 first so a .local host doesn't stall on AAAA (../_ipv4).
  return proxyToAgent({
    target: host.target,
    path: "/api/vision/detector",
    method: "PUT",
    apiKey: String(env.payload.apiKey ?? "").trim(),
    json: { model_id: modelId },
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
