"use client";

/**
 * @module ground-station/use-gs-poll
 * @description The one polling loop every ground-station tab uses.
 *
 * A fixed `setInterval` queues overlapping requests onto an agent that is
 * already slow, which is exactly the load that made it slow. This re-arms a
 * `setTimeout` once each request settles, so there is at most one request in
 * flight and later responses can never land out of order. The cadence is
 * fixed: a node that stops answering is retried at the same interval, so a
 * rebooted ground station is noticed on the next tick. A hidden document
 * costs nothing.
 *
 * The callback is held in a ref written from an effect (never during render —
 * a discarded concurrent render would leave the ref pointing at a URL that was
 * never committed), so a caller may pass an inline closure.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import {
  groundStationApiFromAgent,
  type GroundStationApi,
} from "@/lib/api/ground-station-api";

export function useGroundStationPoll(
  agentUrl: string | null,
  apiKey: string | null,
  baseMs: number,
  run: (api: GroundStationApi) => Promise<void>,
): void {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    // Null in demo mode and with no agent URL. Gating on the CLIENT rather
    // than the raw URL is what stops a demo session fetching the non-HTTP
    // `mock://demo` forever.
    if (!api) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) {
        try {
          await runRef.current(api);
        } catch {
          // The store each loader writes owns the operator-visible error.
        }
      }
      if (!cancelled) timer = setTimeout(tick, baseMs);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [agentUrl, apiKey, baseMs]);
}
