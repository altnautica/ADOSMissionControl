/**
 * @module LanPairVisionUploadRoute
 * @description Server-side proxy for the LAN agent's
 * `POST /api/vision/models/upload` (multipart) endpoint. Sibling to the
 * pairing proxy routes (local-first): lets an HTTPS Mission
 * Control sideload a custom vision model to a drone over the operator's
 * LAN without the browser's mixed-content guard blocking the
 * cross-protocol upload.
 *
 * The browser POSTs a `multipart/form-data` body carrying `host`,
 * `apiKey`, `file`, and `metadata` (a JSON string). The server reads the
 * routing fields, rebuilds a clean multipart with just `file` + `metadata`,
 * and forwards it with the `X-ADOS-Key` header. The agent's JSON body and
 * status are returned unchanged (see `../_proxy`).
 *
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import {
  checkAgentHost,
  proxyError,
  proxyToAgent,
  readFormEnvelope,
} from "../_proxy";

export const runtime = "nodejs";

// Uploads can be tens of MB over a LAN; give the round-trip room.
const UPSTREAM_TIMEOUT_MS = 120000;

/** Largest multipart body accepted. Detector models (.rknn / .onnx / .tflite /
 * .engine) sit well under this; the ceiling bounds what the server buffers. */
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const env = await readFormEnvelope(req, MAX_UPLOAD_BYTES);
  if ("reject" in env) return env.reject;
  const { form } = env;
  const host = checkAgentHost(String(form.get("host") ?? "").trim());
  if ("reject" in host) return host.reject;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return proxyError(400, "file_required", "file is required");
  }
  const metadata = form.get("metadata");
  if (typeof metadata !== "string") {
    return proxyError(400, "metadata_required", "metadata json is required");
  }

  // Rebuild a clean upstream form so the routing-only fields (host/apiKey)
  // never reach the agent.
  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name);
  upstreamForm.append("metadata", metadata);

  return proxyToAgent({
    target: host.target,
    path: "/api/vision/models/upload",
    method: "POST",
    apiKey: String(form.get("apiKey") ?? "").trim(),
    form: upstreamForm,
    timeoutMs: UPSTREAM_TIMEOUT_MS,
  });
}
