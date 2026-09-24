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
 * - a synchronous enable gate (a ~9 s grace on `agentVideoState` leaving
 *   "running") so a single flaky agent poll can't tear down a healthy session,
 *   and so the gate is `true` on the first render when video is already
 *   running (a deferred effect-based gate was the bug — it missed the first
 *   cascade pass);
 * - indefinite fixed-interval auto-retry while the agent reports the video
 *   service running, so the feed self-heals whenever the link recovers;
 * - a stall re-cascade driven by the frozen-stream watchdog and by a
 *   `disconnected` peer connection that did not come back.
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

/**
 * Auto-recovery interval, fixed.
 *
 * Not exponential, and with no attempt cap. The previous loop doubled 3 s to
 * a 30 s ceiling, which on a link that flaps for a minute leaves the operator
 * waiting half a minute for a reconnect that would have succeeded
 * immediately. A recovery loop on an aircraft has one job — keep trying at a
 * rate that is cheap and predictable — and any ceiling, cap, or terminal
 * failed state is a state that needs a human to clear.
 */
const RETRY_DELAY_SEC = 3;

/**
 * How long the agent may report video as not running before the session is
 * disabled: three of its ~3 s status polls. Measured in time, not in renders,
 * because a steady "stopped" report does not change the prop and so never
 * re-runs an effect that counts changes.
 */
const NOT_RUNNING_GRACE_MS = 9_000;

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
  /** The agent's reported video state for the source being dialled, as
   *  resolved by {@link useResolvedAgentVideo} (singleton store, else the
   *  funnelled fleet-status row). The enable, retry and stall gates key off
   *  it, so it must describe the same source as `whepUrl`. */
  agentVideoState: string;
  /** Force the session enabled even when the agent does not report video
   *  running — used for a manual override (e.g. a SITL/Gazebo URL) that has no
   *  agent video state but must still connect. */
  forceEnabled?: boolean;
}

export interface SingletonAgentVideoResult {
  state: CascadeResult["state"];
  activeTransport: CascadeResult["activeTransport"];
  error: string | null;
  /** Manual reconnect: re-runs the cascade immediately. */
  retry: () => void;
  /** Seconds until the next automatic retry (0 when not waiting). */
  retryDelaySec: number;
}

export function useSingletonAgentVideo({
  whepUrl,
  cloudDeviceId,
  transportMode,
  videoEl,
  agentVideoState,
  forceEnabled = false,
}: SingletonAgentVideoOpts): SingletonAgentVideoResult {
  const videoStallSignal = useVideoStore((s) => s.videoStallSignal);

  const [retryKey, setRetryKey] = useState(0);
  const [retryDelaySec, setRetryDelaySec] = useState(0);

  const handleRetry = useCallback(() => {
    setRetryDelaySec(0);
    setRetryKey((k) => k + 1);
  }, []);

  // Stabilise the enabled flag: the agent must report video as not running
  // for the whole grace window before the session is disabled, so a single
  // transient poll doesn't kill a healthy WebRTC session, and the gate is
  // already true on the first render when video is running. A manual override
  // forces it on regardless of the agent's reported state.
  const liveGate = forceEnabled || agentVideoState === "running";
  const [stableEnabled, setStableEnabled] = useState(true);
  useEffect(() => {
    if (liveGate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStableEnabled(true);
      return;
    }
    const handle = setTimeout(() => setStableEnabled(false), NOT_RUNNING_GRACE_MS);
    return () => clearTimeout(handle);
  }, [liveGate]);

  const cascade = useVideoTransportCascade({
    agentWhepUrl: whepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
    retryKey,
    enabled: stableEnabled,
  });

  // A healthy connect stops any pending countdown display.
  useEffect(() => {
    if (cascade.state === "connected") setRetryDelaySec(0);
  }, [cascade.state]);

  // The stall edge: either the frozen-stream watchdog saw both counters flat,
  // or a `disconnected` peer connection did not come back inside its grace
  // window. Re-cascade so the WHEP offer is re-fetched (WHEP cannot
  // renegotiate in place).
  const lastHandledStallRef = useRef(videoStallSignal);
  useEffect(() => {
    if (videoStallSignal === lastHandledStallRef.current) return;
    lastHandledStallRef.current = videoStallSignal;
    if (agentVideoState !== "running") return;
    setRetryDelaySec(0);
    setRetryKey((k) => k + 1);
  }, [videoStallSignal, agentVideoState]);

  // Indefinite fixed-interval auto-retry while the agent reports the video
  // service running (or a manual override is forcing the session) — the feed
  // self-heals whenever the link recovers, at the same predictable rate on
  // attempt one and attempt one thousand.
  useEffect(() => {
    const shouldRetry =
      cascade.state === "failed" &&
      (agentVideoState === "running" || forceEnabled);
    if (!shouldRetry) return;
    setRetryDelaySec(RETRY_DELAY_SEC);
    const handle = setTimeout(() => {
      setRetryDelaySec(0);
      setRetryKey((k) => k + 1);
    }, RETRY_DELAY_SEC * 1000);
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
