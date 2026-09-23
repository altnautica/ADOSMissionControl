"use client";

/**
 * The live engine-detector write seam (local-first).
 *
 * Setting the active detector is an engine-wide config change: the agent writes
 * `vision.detector` and restarts the vision service, so EVERY vision consumer
 * (Follow-Me, obstacle, any plugin on the `vision.detection` bus) then runs the
 * new model. A plugin's `model` / `model_upload` parameter therefore binds to
 * `engine.detector`, not the plugin's own config — and this module is the
 * writer the plugin parameter panel + the model picker call.
 *
 * It resolves the LAN-paired agent for the drone from `local-nodes-store` (the
 * same lookup `plugin-config-writer` uses) and writes through Mission Control's
 * own `/api/lan-pair/vision-detector` proxy route, so the cross-protocol hop
 * works from an HTTPS deployment (the browser can't fetch a plain-HTTP LAN agent
 * directly). Returns `false` honestly when the drone has no LAN seam — the
 * caller surfaces that rather than acting on the wrong agent. Custom-model
 * sideload rides the sibling `/api/lan-pair/vision-upload` proxy.
 *
 * @module skills/vision-detector-writer
 * @license GPL-3.0-only
 */

import { AGENT_SERVICE_RESTART_CLIENT_TIMEOUT_MS, timedFetch } from "@/lib/agent/agent-client/timeout";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import type { VisionUploadMeta } from "@/lib/agent/vision-client";

/** Set the engine's active detector for a drone over its LAN agent. Returns
 * true when the agent wrote the detector AND restarted the vision engine onto
 * it (both the envelope and its `restart.status` read "ok"), false when the
 * drone has no LAN seam. Throws with the agent's reason otherwise — a failed
 * engine restart included, whatever the HTTP status: the engine keeps running
 * the previous model then.
 * The deadline covers that restart. */
export async function setEngineDetector(input: {
  droneId: string;
  modelId: string;
}): Promise<boolean> {
  const agent = resolveLocalAgentForDrone(input.droneId);
  if (!agent) return false;

  const res = await timedFetch(
    "/api/lan-pair/vision-detector",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: agent.agentUrl,
        apiKey: agent.apiKey,
        modelId: input.modelId,
      }),
    },
    AGENT_SERVICE_RESTART_CLIENT_TIMEOUT_MS,
  );
  const text = await res.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // A non-JSON body (a proxy or transport page) is reported as text below.
  }
  const restart =
    body.restart && typeof body.restart === "object" && !Array.isArray(body.restart)
      ? (body.restart as Record<string, unknown>)
      : {};
  // Success needs the agent's own restart verdict, not only a 2xx envelope:
  // the engine keeps the old model until ados-vision restarts onto the new one.
  if (res.ok && body.status === "ok" && restart.status === "ok") return true;
  const reason = [restart.message, body.message, body.error].find(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  throw new Error(reason ?? (text || `HTTP ${res.status}`));
}

/** Sideload a custom model to a drone over its LAN agent. Returns
 * the assigned model id when the upload landed, or null when the drone has no
 * LAN seam. Throws on an agent/transport error. */
export async function uploadEngineModel(input: {
  droneId: string;
  file: File;
  meta: VisionUploadMeta;
}): Promise<{ modelId: string | null; verified: boolean } | null> {
  const agent = resolveLocalAgentForDrone(input.droneId);
  if (!agent) return null;

  const form = new FormData();
  form.append("host", agent.agentUrl);
  form.append("apiKey", agent.apiKey);
  form.append("file", input.file, input.file.name);
  form.append(
    "metadata",
    JSON.stringify({
      name: input.meta.name,
      classes: input.meta.classes,
      head: input.meta.head,
      input_w: input.meta.inputWidth,
      input_h: input.meta.inputHeight,
      runtime: input.meta.runtime,
      board_match: input.meta.boardMatch,
    }),
  );

  const res = await fetch("/api/lan-pair/vision-upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text || `HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    modelId: typeof body.model_id === "string" ? body.model_id : null,
    verified: body.verified === true,
  };
}
