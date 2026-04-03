"use client";

/**
 * @module MiniVideoView
 * @description Compact video thumbnail for the Drone Context Rail.
 * Shows live video via WebRTC WHEP (direct mode) or MSE (cloud mode).
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { VideoOff, Loader2 } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVideoStore } from "@/stores/video-store";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";

export function MiniVideoView() {
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const cloudStreaming = useVideoStore((s) => s.cloudStreaming);
  const setCloudStreaming = useVideoStore((s) => s.setCloudStreaming);
  const agentWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const clientConfig = useConvexSkipQuery(communityApi.clientConfig.get);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<{ stop: () => void } | null>(null);
  const directStreamingRef = useRef(false);
  const [directStreaming, setDirectStreaming] = useState(false);
  directStreamingRef.current = directStreaming;
  const [connecting, setConnecting] = useState(false);

  // Cloud mode fallback: MSE player (only if WHEP isn't already streaming)
  useEffect(() => {
    if (!cloudMode || !cloudDeviceId || !videoRef.current || directStreamingRef.current) return;

    let cancelled = false;

    async function startPlayer() {
      const { MsePlayer } = await import("@/lib/video/mse-player");
      if (cancelled || !videoRef.current) return;

      const player = new MsePlayer();
      playerRef.current = player;
      player.start(cloudDeviceId!, videoRef.current!, clientConfig?.videoRelayUrl ?? undefined);
      setCloudStreaming(true);
    }

    startPlayer();

    return () => {
      cancelled = true;
      playerRef.current?.stop();
      playerRef.current = null;
      setCloudStreaming(false);
    };
  }, [cloudMode, cloudDeviceId, setCloudStreaming, clientConfig?.videoRelayUrl]);

  // WebRTC WHEP: try in any mode (works on LAN even in cloud mode)
  useEffect(() => {
    if (!agentWhepUrl || agentVideoState !== "running") return;

    let cancelled = false;
    setConnecting(true);

    async function connect() {
      try {
        const { startStream } = await import("@/lib/video/webrtc-client");
        if (cancelled || !videoRef.current) return;

        const stream = await startStream(agentWhepUrl!);
        if (cancelled) return;

        videoRef.current!.srcObject = stream;
        setDirectStreaming(true);
        setConnecting(false);
      } catch {
        if (!cancelled) {
          setDirectStreaming(false);
          setConnecting(false);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      setConnecting(false);
      setDirectStreaming(false);
      import("@/lib/video/webrtc-client").then(({ stopStream }) => {
        stopStream();
      });
    };
  }, [cloudMode, agentWhepUrl, agentVideoState]);

  // Cloud mode rendering
  if (cloudMode && cloudDeviceId) {
    return (
      <div className="relative rounded border border-border-default bg-bg-tertiary overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-[112px] object-cover bg-black"
        />
        {!cloudStreaming && (
          <div className="absolute inset-0 flex items-center justify-center text-text-tertiary">
            <div className="flex flex-col items-center gap-1">
              <VideoOff size={18} />
              <span className="text-[10px]">CONNECTING...</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Direct mode rendering
  if (agentWhepUrl && agentVideoState === "running") {
    return (
      <div className="relative rounded border border-border-default bg-bg-tertiary overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-[112px] object-cover bg-black"
        />
        {!directStreaming && (
          <div className="absolute inset-0 flex items-center justify-center text-text-tertiary">
            <div className="flex flex-col items-center gap-1">
              {connecting ? (
                <Loader2 size={18} className="animate-spin text-accent-primary" />
              ) : (
                <VideoOff size={18} />
              )}
              <span className="text-[10px]">{connecting ? "CONNECTING..." : "NO SIGNAL"}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // No video available
  return (
    <div className="rounded border border-border-default bg-bg-tertiary overflow-hidden">
      <div className="flex items-center justify-center h-[112px] text-text-tertiary">
        <div className="flex flex-col items-center gap-1">
          <VideoOff size={18} />
          <span className="text-[10px]">NO SIGNAL</span>
        </div>
      </div>
    </div>
  );
}
