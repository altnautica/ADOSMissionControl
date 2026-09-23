"use client";

/**
 * @module use-vision-engine-models
 * @description Polls the agent's vision engine status (`GET /api/vision/status`)
 * so the hub can show a model that is LOADED on the drone but publishing nothing
 * (idle), per-model fps/latency, and node NPU utilization — the read-back that
 * the live-stream view (`useVisionPipelines`) alone cannot surface, since a
 * stream only exists while a model is actively producing detections.
 *
 * The read is LAN-direct (the same posture as the live-detection socket it
 * complements): on a hosted HTTPS session neither flows and the poll fails
 * quietly, so the panel degrades to the stream-only view rather than erroring.
 * In demo mode the canned client answers with a small model set.
 *
 * `useVisionEngineStatus()` returns the full status; its `known` flag is false
 * whenever there is no read-back, so callers never show an empty list as zero.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";

import { resolveVisionClient } from "@/lib/vision/resolve-vision-client";
import {
  EMPTY_ENGINE_STATUS,
  type EngineStatus,
} from "@/lib/agent/vision-client";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

/** How often to re-read the engine status. A registered model changing is
 * rare (a detector swap / a plugin registering), so a slow poll is plenty. */
export const ENGINE_MODELS_POLL_MS = 5000;

/**
 * The engine's status for the active agent (registered models + NPU
 * utilization + model count), refreshed on a slow poll while mounted. Returns
 * the empty status until the first read lands, on any failure (unreachable
 * engine / older agent / HTTPS-blocked), and when no LAN client is resolvable.
 * The value is stable between reads.
 */
export function useVisionEngineStatus(): EngineStatus {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const [status, setStatus] = useState<EngineStatus>(EMPTY_ENGINE_STATUS);

  const client = useMemo(
    () => resolveVisionClient(agentUrl, apiKey),
    [agentUrl, apiKey],
  );

  const canRead = !!client?.getEngineStatus;

  useEffect(() => {
    if (!client?.getEngineStatus) return;
    // `cancelled` guards a stale async result landing after the client changed:
    // the effect re-runs on a new `client`, flipping the old run's flag first.
    let cancelled = false;
    const read = async () => {
      try {
        const next = await client.getEngineStatus!();
        if (!cancelled) setStatus(next);
      } catch {
        // Unreachable engine / older agent / mixed-content on HTTPS: drop back
        // to the empty status and let the live-stream view carry the panel.
        if (!cancelled) setStatus(EMPTY_ENGINE_STATUS);
      }
    };
    void read();
    const id = setInterval(read, ENGINE_MODELS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  // With no engine read-back (older agent / cloud-only) the last-good status is
  // never cleared by the effect, so gate it here rather than with a setState.
  return canRead ? status : EMPTY_ENGINE_STATUS;
}
