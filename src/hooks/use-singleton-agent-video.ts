"use client";

/**
 * @module use-singleton-agent-video
 * @description The one connection brain for the singleton agent-video surfaces
 * (the focused drone's Agent-tab feed and the Overview "Fly" pane). Both render
 * the same single WebRTC session, so they MUST gate, retry, and self-heal
 * identically — otherwise one surface streams while the other sticks on a
 * placeholder (exactly the Fly-tab-vs-Agent-tab divergence this hook removes).
 *
 * Wraps {@link useVideoTransportCascade} and adds:
 * - a synchronous enable gate (3-strikes debounce on `agentVideoState`) so a
 *   single flaky agent poll can't tear down a healthy session, and so the gate
 *   is `true` on the first render when video is already running (a deferred
 *   effect-based gate was the bug — it missed the first cascade pass);
 * - indefinite exponential-backoff auto-retry while the agent reports the video
 *   service running, so the feed self-heals whenever the link recovers;
 * - a stall re-cascade driven by the frozen-stream watchdog.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useVideoStore } from "@/stores/video-store";
import {
  useVideoTransportCascade,
  type CascadeResult,
} from "@/hooks/use-video-transport-cascade";

type TransportMode = "auto" | "lan-whep" | "p2p-mqtt" | "off";

// Auto-recovery backoff. The base delay doubles per attempt, clamps at the
// ceiling, then keeps retrying at the ceiling so a link that recovers hours
// later still reconnects with no operator action.
const RETRY_BASE_DELAY_SEC = 3;
const RETRY_MAX_DELAY_SEC = 30;

interface SingletonAgentVideoOpts {
  /** Effective LAN WHEP URL to dial (a manual override URL wins over the
   *  auto-discovered agent URL; the caller resolves which). */
  whepUrl: string | null;
  /** Cloud device id enabling the P2P-MQTT fallback transport. */
  cloudDeviceId: string | null;
  /** User transport preference (auto / pinned / off). */
  transportMode: TransportMode;
  /** The bound <video> element (callback-ref'd so the cascade re-runs on mount). */
  videoEl: HTMLVideoElement | null;
  /** Force the session enabled even when the agent does not report video
   *  running — used for a manual override (e.g. a SITL/Gazebo URL) that has no
   *  agent video state but must still connect. */
  forceEnabled?: boolean;
}

export interface SingletonAgentVideoResult {
  state: CascadeResult["state"];
  activeTransport: CascadeResult["activeTransport"];
  error: string | null;
  /** Manual reconnect: resets the backoff and re-runs the cascade. */
  retry: () => void;
  /** Seconds until the next automatic retry (0 when not backing off). */
  retryDelaySec: number;
}

export function useSingletonAgentVideo({
  whepUrl,
  cloudDeviceId,
  transportMode,
  videoEl,
  forceEnabled = false,
}: SingletonAgentVideoOpts): SingletonAgentVideoResult {
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const videoStallSignal = useVideoStore((s) => s.videoStallSignal);

  const [retryKey, setRetryKey] = useState(0);
  const retryAttemptRef = useRef(0);
  const [retryDelaySec, setRetryDelaySec] = useState(0);

  const handleRetry = useCallback(() => {
    retryAttemptRef.current = 0;
    setRetryDelaySec(0);
    setRetryKey((k) => k + 1);
  }, []);

  // Stabilise the enabled flag: require 3 consecutive non-"running" polls
  // (~9s) before disabling so a single transient agent poll doesn't kill a
  // healthy WebRTC session, and so the gate is already true on the first
  // render when video is running. A manual override forces it on regardless
  // of the agent's reported state.
  //
  // The backoff counter must NOT be mutated during render (a `useMemo` side
  // effect was the bug): React 19 StrictMode double-invokes render bodies in
  // dev, which double-counted every strike and halved the 3-strike debounce.
  // Mutating the ref in an effect (once per committed update) keeps the count
  // exact.
  const nonRunningCountRef = useRef(0);
  const [stableEnabled, setStableEnabled] = useState(true);
  useEffect(() => {
    if (forceEnabled || agentVideoState === "running") {
      nonRunningCountRef.current = 0;
      setStableEnabled(true);
      return;
    }
    nonRunningCountRef.current += 1;
    setStableEnabled(nonRunningCountRef.current < 3);
  }, [agentVideoState, forceEnabled]);

  const cascade = useVideoTransportCascade({
    agentWhepUrl: whepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
    retryKey,
    enabled: stableEnabled,
  });

  // Reset the backoff counter on a healthy connect.
  useEffect(() => {
    if (cascade.state === "connected") {
      retryAttemptRef.current = 0;
      setRetryDelaySec(0);
    }
  }, [cascade.state]);

  // The frozen-stream watchdog raised the stall signal: the link looked
  // "connected" but stopped delivering frames. Re-cascade so the WHEP offer is
  // re-fetched (WHEP cannot renegotiate in place).
  const lastHandledStallRef = useRef(videoStallSignal);
  useEffect(() => {
    if (videoStallSignal === lastHandledStallRef.current) return;
    lastHandledStallRef.current = videoStallSignal;
    if (agentVideoState !== "running") return;
    setRetryDelaySec(0);
    setRetryKey((k) => k + 1);
  }, [videoStallSignal, agentVideoState]);

  // Indefinite auto-retry with capped exponential backoff while the agent
  // reports the video service running (or a manual override is forcing the
  // session) — the feed self-heals whenever the link recovers.
  useEffect(() => {
    const shouldRetry =
      cascade.state === "failed" &&
      (agentVideoState === "running" || forceEnabled);
    if (!shouldRetry) return;
    const delaySec = Math.min(
      RETRY_BASE_DELAY_SEC * Math.pow(2, retryAttemptRef.current),
      RETRY_MAX_DELAY_SEC,
    );
    setRetryDelaySec(delaySec);
    const handle = setTimeout(() => {
      retryAttemptRef.current += 1;
      setRetryDelaySec(0);
      setRetryKey((k) => k + 1);
    }, delaySec * 1000);
    return () => clearTimeout(handle);
  }, [cascade.state, agentVideoState, forceEnabled]);

  return {
    state: cascade.state,
    activeTransport: cascade.activeTransport,
    error: cascade.error,
    retry: handleRetry,
    retryDelaySec,
  };
}
