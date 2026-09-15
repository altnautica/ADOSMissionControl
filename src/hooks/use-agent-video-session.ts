"use client";

/**
 * @module use-agent-video-session
 * @description Independent LAN WHEP session for one Command overview tile.
 * Focused views keep using the singleton VideoFeedCard stack.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { LAN_ICE_GATHER_TIMEOUT_MS, LAN_ONTRACK_TIMEOUT_MS } from "@/lib/video/webrtc-constants";
import {
  applyJitterTarget,
  NEGOTIATED_JITTER_TARGET_MS,
} from "@/lib/video/webrtc/jitter-controller";

export type AgentVideoSessionState = "idle" | "connecting" | "connected" | "failed";

interface AgentVideoSessionStats {
  fps: number;
  bitrateKbps: number;
}

interface AgentVideoSessionResult {
  state: AgentVideoSessionState;
  error: string | null;
  stats: AgentVideoSessionStats;
}

const emptyStats: AgentVideoSessionStats = { fps: 0, bitrateKbps: 0 };

function closePeerConnection(pc: RTCPeerConnection | null): void {
  if (!pc) return;
  try {
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.onicegatheringstatechange = null;
  } catch { /* noop */ }
  try {
    pc.getReceivers().forEach((receiver) => receiver.track?.stop());
  } catch { /* noop */ }
  try {
    pc.close();
  } catch { /* noop */ }
}

export function useAgentVideoSession({
  whepUrl,
  enabled,
  videoEl,
  retryKey,
}: {
  whepUrl: string | null;
  enabled: boolean;
  videoEl: HTMLVideoElement | null;
  retryKey: number;
}): AgentVideoSessionResult {
  const [state, setState] = useState<AgentVideoSessionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AgentVideoSessionStats>(emptyStats);

  useEffect(() => {
    if (!enabled || !whepUrl || !videoEl) {
      if (videoEl) videoEl.srcObject = null;
      setState("idle");
      setError(null);
      setStats(emptyStats);
      return;
    }

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let statsInterval: ReturnType<typeof setInterval> | null = null;
    const controller = new AbortController();

    async function connect() {
      if (!whepUrl) return;
      setState("connecting");
      setError(null);
      setStats(emptyStats);

      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.onconnectionstatechange = () => {
          if (!pc || cancelled) return;
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            setState("failed");
            setError(`Connection ${pc.connectionState}`);
          }
        };

        const offer = await pc.createOffer();
        if (cancelled) return;
        await pc.setLocalDescription(offer);

        await new Promise<void>((resolve) => {
          if (!pc || pc.iceGatheringState === "complete") {
            resolve();
            return;
          }
          const timeout = setTimeout(resolve, LAN_ICE_GATHER_TIMEOUT_MS);
          pc.onicegatheringstatechange = () => {
            if (pc?.iceGatheringState === "complete") {
              clearTimeout(timeout);
              resolve();
            }
          };
        });
        if (cancelled || !pc?.localDescription?.sdp) return;

        const response = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription.sdp,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "No stream"
              : `WHEP ${response.status}`,
          );
        }
        const answerSdp = await response.text();
        if (cancelled || !pc) return;

        const trackPromise = new Promise<MediaStream>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("No video track")),
            LAN_ONTRACK_TIMEOUT_MS,
          );
          if (!pc) {
            clearTimeout(timeout);
            reject(new Error("Connection closed"));
            return;
          }
          pc.ontrack = (event) => {
            if (event.streams[0]) {
              clearTimeout(timeout);
              resolve(event.streams[0]);
            }
          };
        });

        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
        // Same negotiated receiver depth the cockpit session gets, applied at
        // the same point (a target set before the answer is applied does not
        // survive the receiver's association). A tile used to get whatever
        // the browser chose while the cockpit got a deliberate value, so the
        // two surfaces showed the same feed at different latencies.
        applyJitterTarget(pc, NEGOTIATED_JITTER_TARGET_MS);
        const stream = await trackPromise;
        if (cancelled || !pc) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (videoEl) videoEl.srcObject = stream;
        setState("connected");

        let lastFrames = 0;
        let lastBytes = 0;
        let lastAt = performance.now();
        statsInterval = setInterval(async () => {
          if (!pc || cancelled) return;
          const report = await pc.getStats();
          let frames = 0;
          let bytes = 0;
          report.forEach((entry) => {
            const stat = entry as RTCInboundRtpStreamStats;
            if (stat.type === "inbound-rtp" && stat.kind === "video") {
              frames = stat.framesDecoded ?? frames;
              bytes = stat.bytesReceived ?? bytes;
            }
          });
          const now = performance.now();
          const elapsed = Math.max(1, now - lastAt);
          const fps = Math.max(0, Math.round(((frames - lastFrames) * 1000) / elapsed));
          const bitrateKbps = Math.max(0, Math.round(((bytes - lastBytes) * 8) / elapsed));
          lastFrames = frames;
          lastBytes = bytes;
          lastAt = now;
          setStats({ fps, bitrateKbps });
        }, 1000);
      } catch (err) {
        if (cancelled) return;
        setState("failed");
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    connect();

    return () => {
      cancelled = true;
      controller.abort();
      if (statsInterval) clearInterval(statsInterval);
      closePeerConnection(pc);
      if (videoEl) videoEl.srcObject = null;
    };
  }, [enabled, retryKey, videoEl, whepUrl]);

  return { state, error, stats };
}
