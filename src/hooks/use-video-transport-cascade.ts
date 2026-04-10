/**
 * @module use-video-transport-cascade
 * @description DEC-107 Phase H: video transport cascade hook.
 *
 * Decides which transport to use for the active video stream based on user
 * preference (auto / pinned mode / off) and tries each one with per-mode
 * timeout. In Auto mode, cascades through LAN Direct → P2P MQTT. In pinned
 * mode, tries only the chosen transport and surfaces the error if it fails
 * (no fallback).
 *
 * Replaces the inline transport-selection logic that previously lived in
 * VideoFeedCard's useEffect. Extracted so it can be unit-tested in
 * isolation and reused by future video surfaces (e.g. PiP popout).
 *
 * Cloud WHEP and Cloud MSE modes are deferred per Plan Part H — the cascade
 * stops at P2P MQTT in this phase.
 *
 * All mutable cascade state lives in useRef to survive Turbopack HMR
 * cleanly. Phase E learnings: module-level globals get reset on HMR.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useState } from "react";
import {
  startStream,
  startStreamViaMqttSignaling,
  stopStream,
} from "@/lib/video/webrtc-client";
import { useVideoStore, type VideoTransport } from "@/stores/video-store";

type TransportMode = "auto" | "lan-whep" | "p2p-mqtt" | "off";

interface CascadeOpts {
  agentWhepUrl: string | null;     // from heartbeat / poll
  cloudDeviceId: string | null;    // from agent connection store
  transportMode: TransportMode;    // user preference
  videoEl: HTMLVideoElement | null;
  retryKey: number;                // bump to force re-cascade
  enabled: boolean;                // false when video service not running
}

interface CascadeResult {
  state: "idle" | "connecting" | "connected" | "failed";
  activeTransport: VideoTransport;
  error: string | null;
}

// Per-mode timeout (ms). LAN should fail fast — loopback / RFC1918 either
// responds in a couple seconds or won't respond at all. P2P MQTT gets more
// time because cellular ICE punching is slow.
const LAN_TIMEOUT_MS = 4000;
const P2P_TIMEOUT_MS = 10000;

export function useVideoTransportCascade(opts: CascadeOpts): CascadeResult {
  const {
    agentWhepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
    retryKey,
    enabled,
  } = opts;

  const [state, setState] = useState<CascadeResult["state"]>("idle");
  const [activeTransport, setActiveTransport] = useState<VideoTransport>("unknown");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || transportMode === "off") {
      // Off mode: stop any active stream and idle
      stopStream();
      // Part I P0-4: clear srcObject so the video element doesn't keep
      // showing the last decoded frame as a frozen image.
      if (videoEl) videoEl.srcObject = null;
      setState("idle");
      setActiveTransport(transportMode === "off" ? "off" : "unknown");
      setError(null);
      return;
    }
    if (!videoEl) return;

    // Part I P0-2 + P0-3: per-run cancellation token. Each effect invocation
    // gets its OWN local `cancelled` flag (closed-over by runCascade) plus
    // its own AbortController. The cleanup function flips THIS run's token,
    // not a shared ref, so a previous run can never reset the new run's
    // cancellation. The AbortController aborts the underlying webrtc-client
    // operation so it bails at its next checkpoint instead of running to
    // completion in the background.
    let cancelled = false;
    const controller = new AbortController();

    setState("connecting");
    setError(null);

    // DEC-107 Phase H: build the cascade list based on mode.
    // In cloud mode (cloudDeviceId set), skip LAN Direct — the agent's
    // RFC1918 IP is unreachable from a cloud-connected browser. Go straight
    // to P2P MQTT which works across NAT via MQTT-relayed SDP signaling.
    const cascade: VideoTransport[] =
      transportMode === "auto"
        ? cloudDeviceId
          ? ["p2p-mqtt"]
          : ["lan-whep", "p2p-mqtt"]
        : [transportMode];

    // Per-mode timeout handle so we can clear it on success/abort
    let modeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

    async function tryMode(mode: VideoTransport): Promise<MediaStream | null> {
      const timeoutMs = mode === "lan-whep" ? LAN_TIMEOUT_MS : P2P_TIMEOUT_MS;
      const label = mode === "lan-whep" ? "LAN Direct" : "P2P MQTT";

      // Per-mode AbortController so timing out one mode doesn't abort the
      // whole cascade. Cascading from LAN → P2P uses fresh signals.
      const modeController = new AbortController();
      // Forward the cascade-level abort to the per-mode controller.
      const onCascadeAbort = () => modeController.abort();
      controller.signal.addEventListener("abort", onCascadeAbort, { once: true });

      modeTimeoutHandle = setTimeout(() => {
        modeController.abort();
      }, timeoutMs);

      try {
        if (mode === "lan-whep") {
          if (!agentWhepUrl) {
            throw new Error("LAN Direct unavailable: no agent WHEP URL");
          }
          return await startStream(agentWhepUrl, modeController.signal);
        }
        if (mode === "p2p-mqtt") {
          if (!cloudDeviceId) {
            throw new Error("P2P MQTT unavailable: agent not paired");
          }
          return await startStreamViaMqttSignaling(cloudDeviceId, modeController.signal);
        }
        return null;
      } catch (err) {
        const isAbort = err instanceof DOMException && err.name === "AbortError";
        const isTimeout = isAbort && !controller.signal.aborted;
        const msg = isTimeout
          ? `${label} timeout after ${timeoutMs}ms`
          : err instanceof Error ? err.message : String(err);
        console.log(`[transport-cascade] ${mode} failed: ${msg}`);
        return null;
      } finally {
        if (modeTimeoutHandle) {
          clearTimeout(modeTimeoutHandle);
          modeTimeoutHandle = null;
        }
        controller.signal.removeEventListener("abort", onCascadeAbort);
      }
    }

    async function runCascade() {
      let lastErrorMode: VideoTransport | null = null;
      for (const mode of cascade) {
        if (cancelled) return;
        setActiveTransport(mode);
        const stream = await tryMode(mode);
        if (cancelled) {
          // We were cancelled mid-mode. If a stream slipped through despite
          // the abort (rare race), clean it up.
          if (stream) {
            stopStream();
            if (videoEl) videoEl.srcObject = null;
          }
          return;
        }
        if (stream) {
          // videoEl was non-null at effect entry (we returned early otherwise),
          // and refs don't change identity within an effect run.
          videoEl!.srcObject = stream;
          setState("connected");
          setActiveTransport(mode);
          setError(null);
          return;
        }
        lastErrorMode = mode;
      }
      // All modes exhausted
      if (cancelled) return;
      const health = useVideoStore.getState().transportHealth;
      const lastErr = lastErrorMode ? health[lastErrorMode]?.lastError : null;
      setState("failed");
      setActiveTransport("unknown");
      setError(
        transportMode === "auto"
          ? `All transports failed${lastErr ? `: ${lastErr}` : ""}`
          : lastErr ?? "Connection failed",
      );
    }

    runCascade();

    return () => {
      cancelled = true;
      controller.abort();
      if (modeTimeoutHandle) {
        clearTimeout(modeTimeoutHandle);
        modeTimeoutHandle = null;
      }
      stopStream();
      // Part I P0-4: clear srcObject on teardown
      if (videoEl) videoEl.srcObject = null;
    };
  }, [
    agentWhepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
    retryKey,
    enabled,
  ]);

  return { state, activeTransport, error };
}
