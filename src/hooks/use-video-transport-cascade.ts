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

import { useEffect, useRef, useState } from "react";
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

// Per-mode timeout (ms). LAN should fail fast (no route on cross-network).
// P2P MQTT gets more time because cellular ICE punching is slow.
const LAN_TIMEOUT_MS = 4000;
const P2P_TIMEOUT_MS = 14000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

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

  // Cascade-internal state in refs so HMR doesn't reset mid-attempt
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || transportMode === "off") {
      // Off mode: stop any active stream and idle
      stopStream();
      setState("idle");
      setActiveTransport("off");
      setError(null);
      return;
    }
    if (!videoEl) return;

    cancelledRef.current = false;
    if (inFlightRef.current) {
      // Tear down whatever attempt is running before starting fresh
      stopStream();
    }
    inFlightRef.current = true;
    setState("connecting");
    setError(null);

    // DEC-107 Phase H: build the cascade list based on mode
    const cascade: VideoTransport[] =
      transportMode === "auto"
        ? ["lan-whep", "p2p-mqtt"]
        : [transportMode];

    async function tryMode(mode: VideoTransport): Promise<MediaStream | null> {
      try {
        if (mode === "lan-whep") {
          if (!agentWhepUrl) {
            throw new Error("LAN Direct unavailable: no agent WHEP URL");
          }
          return await withTimeout(
            startStream(agentWhepUrl),
            LAN_TIMEOUT_MS,
            "LAN Direct",
          );
        }
        if (mode === "p2p-mqtt") {
          if (!cloudDeviceId) {
            throw new Error("P2P MQTT unavailable: agent not paired");
          }
          return await withTimeout(
            startStreamViaMqttSignaling(cloudDeviceId),
            P2P_TIMEOUT_MS,
            "P2P MQTT",
          );
        }
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[transport-cascade] ${mode} failed: ${msg}`);
        return null;
      }
    }

    async function runCascade() {
      let lastErrorMode: VideoTransport | null = null;
      for (const mode of cascade) {
        if (cancelledRef.current) return;
        setActiveTransport(mode);
        const stream = await tryMode(mode);
        if (cancelledRef.current) {
          if (stream) stopStream();
          return;
        }
        if (stream) {
          videoEl!.srcObject = stream;
          setState("connected");
          setActiveTransport(mode);
          setError(null);
          inFlightRef.current = false;
          return;
        }
        lastErrorMode = mode;
      }
      // All modes exhausted
      if (cancelledRef.current) return;
      const health = useVideoStore.getState().transportHealth;
      const lastErr = lastErrorMode ? health[lastErrorMode]?.lastError : null;
      setState("failed");
      setActiveTransport("unknown");
      setError(
        transportMode === "auto"
          ? `All transports failed${lastErr ? `: ${lastErr}` : ""}`
          : lastErr ?? "Connection failed",
      );
      inFlightRef.current = false;
    }

    runCascade();

    return () => {
      cancelledRef.current = true;
      inFlightRef.current = false;
      stopStream();
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
