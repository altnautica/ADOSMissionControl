"use client";

/**
 * @module ground-station/use-gs-poll
 * @description The one polling loop every ground-station tab uses.
 *
 * A fixed `setInterval` queues overlapping requests onto an agent that is
 * already slow, which is exactly the load that made it slow; and with no
 * failure backoff an unreachable agent is hammered at full cadence for as long
 * as the tab is open. This re-arms a `setTimeout` in a `finally`, so there is
 * at most one request in flight, the cadence backs off once the agent stops
 * answering, and a hidden document costs nothing.
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
import { nextPollDelay } from "@/stores/agent-connection/poll-backoff";

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
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const arm = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) {
        // Nothing on screen to keep fresh; check back at the base cadence.
        arm(baseMs);
        return;
      }
      try {
        await runRef.current(api);
        failures = 0;
      } catch {
        // The store each loader writes owns the operator-visible error; the
        // loop's only job is to slow down rather than to report.
        failures += 1;
      } finally {
        arm(nextPollDelay(failures, baseMs));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer ?? undefined);
    };
  }, [agentUrl, apiKey, baseMs]);
}
