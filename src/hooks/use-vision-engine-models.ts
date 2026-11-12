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
 * `useVisionEngineStatus()` returns a tagged status: `{ known: false }` whenever
 * there is no read-back, so callers never show an unread engine as zero.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";

import { resolveVisionClient } from "@/lib/vision/resolve-vision-client";
import {
  UNKNOWN_ENGINE_STATUS,
  type EngineStatus,
} from "@/lib/agent/vision-client";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

/** How often to re-read the engine status. A registered model changing is
 * rare (a detector swap / a plugin registering), so a slow poll is plenty. */
export const ENGINE_MODELS_POLL_MS = 5000;

/** A node's agent connection; null when the node has none. */
export interface VisionEngineConnection {
  agentUrl: string | null;
  apiKey: string | null;
}

/**
 * The engine's status (registered models + NPU utilization + model count),
 * refreshed on a slow poll while mounted. Returns the unknown status until the
 * first read lands, on any failure (unreachable engine / older agent /
 * HTTPS-blocked), and when no LAN client is resolvable. The value is stable
 * between reads.
 *
 * @param conn The rendered node's own connection (null: it has none, so the
 *   status is unknown). Omitted: the attached agent connection.
 */
export function useVisionEngineStatus(conn?: VisionEngineConnection | null): EngineStatus {
  const ambientUrl = useAgentConnectionStore((s) => s.agentUrl);
  const ambientKey = useAgentConnectionStore((s) => s.apiKey);
  const agentUrl = conn === undefined ? ambientUrl : (conn?.agentUrl ?? null);
  const apiKey = conn === undefined ? ambientKey : (conn?.apiKey ?? null);
  const [status, setStatus] = useState<EngineStatus>(UNKNOWN_ENGINE_STATUS);

  // A node with no connection of its own reads nothing, not the demo's
  // canned engine or another node's.
  const noConnection = conn === null;
  const client = useMemo(
    () => (noConnection ? null : resolveVisionClient(agentUrl, apiKey)),
    [noConnection, agentUrl, apiKey],
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
        // to the unknown status and let the live-stream view carry the panel.
        if (!cancelled) setStatus(UNKNOWN_ENGINE_STATUS);
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
  return canRead ? status : UNKNOWN_ENGINE_STATUS;
}
