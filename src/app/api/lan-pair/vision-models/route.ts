/**
 * @module LanPairVisionModelsRoute
 * @description Server-side proxy for the LAN agent's vision model-registry
 * READ endpoints. Sibling to the write proxies (`vision-detector`,
 * `vision-upload`) so the read half of the model picker is HTTPS-LAN-safe
 * too (local-first): an HTTPS Mission Control can list / download /
 * poll a drone's vision models over the operator's LAN without the browser's
 * mixed-content guard blocking the plain-HTTP fetch, because the cross-protocol
 * hop happens server-side.
 *
 * The browser sends `{ host, apiKey, op, modelId? }`:
 *   - `op: "list"`    -> `GET  /api/vision/models`
 *   - `op: "download"`-> `POST /api/vision/models/{modelId}/download`
 *   - `op: "status"`  -> `GET  /api/vision/models/{modelId}/status`
 * The agent's JSON body and status are returned unchanged (see `../_proxy`)
 * so the client coerces them with the same logic it uses on the direct (HTTP/Electron) path.
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import {
  checkAgentHost,
  encodeSegment,
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

  const op = String(payload.op ?? "");
  if (op !== "list" && op !== "download" && op !== "status") {
    return proxyError(400, "bad_op", "op must be list, download, or status");
  }

  const apiKey = String(payload.apiKey ?? "").trim();
  if (op === "list") {
    return proxyToAgent({
      target: host.target,
      path: "/api/vision/models",
      method: "GET",
      apiKey,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
    });
  }

  // modelId is path-encoded exactly as the direct client does so a model id
  // with special characters round-trips identically over either path; an
  // empty or dot-segment id is refused.
  const enc = encodeSegment(String(payload.modelId ?? "").trim());
  if (!enc) {
    return proxyError(400, "model_id_required", "modelId is required");
  }
  return proxyToAgent({
    target: host.target,
    path: `/api/vision/models/${enc}/${op}`,
    method: op === "download" ? "POST" : "GET",
    apiKey,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
