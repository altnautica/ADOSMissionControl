"use client";

import { useEffect, useMemo, useRef } from "react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVideoStore } from "@/stores/video-store";
import { AgentClient } from "@/lib/agent/client";
import { isDemoMode } from "@/lib/utils";

const POLL_INTERVAL_MS = 1000;

interface VideoLatencyResponse {
  latency_ms: number | null;
  ewma_ms?: number | null;
  samples?: number | null;
  source?: string;
}

/**
 * Polls the agent's `/api/video/latency` endpoint at 1 Hz and writes
 * the air-side SEI EWMA and sample count into the video store. The
 * agent feeds the same numbers shown on the LCD; surfacing them in
 * the GCS breakdown popover lets operators attribute latency to the
 * camera->encoder leg vs the network leg vs the browser receive leg.
 *
 * In demo mode synthesises plausible jittering values so the popover
 * renders in `npm run demo` without 404 spam.
 *
 * Skips polling when the agent isn't running its video pipeline.
 */
export function useVideoLatencyPoll(): void {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const setAirLatency = useVideoStore((s) => s.setAirLatency);

  const demoMode = useMemo(() => isDemoMode(), []);

  const client = useMemo(() => {
    if (demoMode) return null;
    if (!agentUrl) return null;
    return new AgentClient(agentUrl, apiKey);
  }, [agentUrl, apiKey, demoMode]);

  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (demoMode) {
      const tick = () => {
        // Walking-jitter mock so the breakdown popover doesn't look frozen.
        const air = 88 + Math.sin(Date.now() / 1700) * 12 + Math.random() * 4;
        const samples = 25 + Math.floor(Math.random() * 6);
        setAirLatency({
          airLatencyMs: Math.round(air),
          airSamples: samples,
          airSource: "sei",
        });
      };
      tick();
      intervalRef.current = window.setInterval(tick, POLL_INTERVAL_MS);
      return () => {
        if (intervalRef.current !== null) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }

    if (!client) return;
    if (agentVideoState !== "running") {
      // Surface "no data" while video is stopped; the popover will
      // render "not measured" instead of stale values.
      setAirLatency({
        airLatencyMs: null,
        airSamples: null,
        airSource: null,
      });
      return;
    }

    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const raw = (await client.getVideoLatency()) as
          | VideoLatencyResponse
          | null;
        if (cancelled || !raw) return;
        setAirLatency({
          airLatencyMs:
            typeof raw.ewma_ms === "number"
              ? raw.ewma_ms
              : typeof raw.latency_ms === "number"
                ? raw.latency_ms
                : null,
          airSamples: typeof raw.samples === "number" ? raw.samples : null,
          airSource: raw.source ?? null,
        });
      } catch {
        if (cancelled) return;
        setAirLatency({
          airLatencyMs: null,
            airSamples: null,
          airSource: "unavailable",
        });
      }
    };

    void fetchOnce();
    intervalRef.current = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [client, agentVideoState, demoMode, setAirLatency]);
}
