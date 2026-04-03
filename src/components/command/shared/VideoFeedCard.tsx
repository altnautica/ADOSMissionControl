"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Maximize2, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVideoStore } from "@/stores/video-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { communityApi } from "@/lib/community-api";

interface VideoFeedCardProps {
  className?: string;
  onPopOut?: () => void;
}

export function VideoFeedCard({ className, onPopOut }: VideoFeedCardProps) {
  const agentWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const cloudStreaming = useVideoStore((s) => s.cloudStreaming);
  const setCloudStreaming = useVideoStore((s) => s.setCloudStreaming);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const clientConfig = useConvexSkipQuery(communityApi.clientConfig.get);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<{ stop: () => void } | null>(null);
  const isStreamingRef = useRef(false);
  isStreamingRef.current = isStreaming;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const handleRetry = () => {
    setError(null);
    setRetryKey((k) => k + 1);
  };

  // Auto-reconnect: when stream drops but agent video is still running
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && agentVideoState === "running" && !connecting) {
      // Stream dropped — auto-retry after 3 seconds
      const timer = setTimeout(() => {
        console.log("[VideoFeedCard] Auto-reconnecting after stream drop");
        setRetryKey((k) => k + 1);
      }, 3000);
      return () => clearTimeout(timer);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, agentVideoState, connecting]);

  // WebRTC WHEP: try in any mode (works on LAN even in cloud mode)
  useEffect(() => {
    if (!agentWhepUrl || agentVideoState !== "running") return;

    let cancelled = false;
    setConnecting(true);
    setError(null);

    async function connect() {
      try {
        const { startStream, setVideoElement } = await import("@/lib/video/webrtc-client");
        if (cancelled || !videoRef.current) return;

        setVideoElement(videoRef.current);
        const stream = await startStream(agentWhepUrl!);
        if (cancelled) return;

        videoRef.current!.srcObject = stream;
        setConnecting(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Connection failed");
          setConnecting(false);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      setConnecting(false);
      import("@/lib/video/webrtc-client").then(({ stopStream }) => {
        stopStream();
      });
    };
  }, [agentWhepUrl, agentVideoState, retryKey]);

  // Cloud mode fallback: MSE player (only if WHEP isn't already streaming)
  useEffect(() => {
    if (!cloudMode || !cloudDeviceId || !videoRef.current || isStreamingRef.current) return;

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

  const hasVideo = isStreaming || cloudStreaming;
  const showConnecting = connecting || agentVideoState === "starting";
  const showNoSignal = !hasVideo && !showConnecting && !error;

  return (
    <div
      className={cn(
        "relative border border-border-default rounded-lg overflow-hidden bg-bg-secondary",
        className
      )}
    >
      {/* 16:9 aspect ratio container */}
      <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
        {/* Video element (always rendered, hidden when no signal) */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={cn(
            "absolute inset-0 w-full h-full object-cover bg-black",
            !hasVideo && "hidden"
          )}
        />

        {/* Video stats overlay */}
        {hasVideo && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 px-2 py-1 bg-black/60 text-[10px] font-mono text-text-secondary">
            <span>{fps > 0 ? `${fps} FPS` : "-- FPS"}</span>
            <span>{latencyMs > 0 ? `${latencyMs}ms` : "--ms"}</span>
            <span>{resolution || "--\u00D7--"}</span>
          </div>
        )}

        {/* No signal placeholder */}
        {showNoSignal && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a0f]">
            <CameraOff className="w-8 h-8 text-text-tertiary" />
            <span className="text-xs text-text-tertiary font-mono tracking-widest">
              NO SIGNAL
            </span>
          </div>
        )}

        {/* Connecting state */}
        {showConnecting && !hasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a0f]">
            <Loader2 className="w-6 h-6 text-accent-primary animate-spin" />
            <span className="text-xs text-text-tertiary font-mono tracking-widest">
              CONNECTING...
            </span>
          </div>
        )}

        {/* Error state with retry */}
        {error && !hasVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a0f]">
            <CameraOff className="w-8 h-8 text-status-error" />
            <span className="text-xs text-status-error font-mono">
              {error}
            </span>
            <button
              onClick={handleRetry}
              className="mt-1 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-text-secondary bg-white/10 hover:bg-white/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              RETRY
            </button>
          </div>
        )}

        {/* No signal with retry (when agent video is running but stream failed) */}
        {showNoSignal && agentVideoState === "running" && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center">
            <button
              onClick={handleRetry}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-text-tertiary bg-white/10 hover:bg-white/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              RECONNECT
            </button>
          </div>
        )}
      </div>

      {/* Top-right action buttons */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <button
          onClick={handleRetry}
          className="p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
          title="Reconnect video"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onPopOut}
          className="p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
          title="Pop out video"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
