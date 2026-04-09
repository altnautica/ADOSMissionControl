"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  CameraOff,
  Maximize2,
  Minimize2,
  Loader2,
  RefreshCw,
  Camera,
  Circle,
  Square,
  PictureInPicture2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVideoStore } from "@/stores/video-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { communityApi } from "@/lib/community-api";
// DEC-108 Phase D follow-up: static import for webrtc-client. Dynamic
// imports inside useEffect were causing Turbopack to HMR-reload the
// module on every unrelated edit, wiping module-level stats state and
// orphaning the active RTCPeerConnection. Static import puts the module
// in the parent's import graph so HMR only invalidates it on direct
// edits to webrtc-client.ts itself.
import {
  startStream,
  startStreamViaMqttSignaling,
  stopStream,
  setVideoElement,
  captureScreenshot,
  startRecording,
  stopRecording,
} from "@/lib/video/webrtc-client";

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
  // DEC-108 Phase D: extended stats + transport indicator
  const codec = useVideoStore((s) => s.codec);
  const bitrateKbps = useVideoStore((s) => s.bitrateKbps);
  const packetsLost = useVideoStore((s) => s.packetsLost);
  const transport = useVideoStore((s) => s.transport);
  const isRecording = useVideoStore((s) => s.isRecording);
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

  // DEC-108 Phase D: video action buttons. The actual capture/record/PiP
  // logic already exists in webrtc-client.ts (captureScreenshot, startRecording,
  // stopRecording) — these handlers just wire UI buttons to those helpers and
  // add fullscreen / picture-in-picture using the standard browser APIs on
  // the underlying <video> element.

  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for fullscreenchange events so we keep our state in sync if the
  // user presses ESC or otherwise exits fullscreen outside our buttons.
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const handleSnapshot = useCallback(() => {
    try {
      captureScreenshot();
    } catch (err) {
      console.warn("[VideoFeedCard] snapshot failed", err);
    }
  }, []);

  const handleRecordToggle = useCallback(() => {
    try {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    } catch (err) {
      console.warn("[VideoFeedCard] record toggle failed", err);
    }
  }, [isRecording]);

  const handleFullscreenToggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current?.requestFullscreen) {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn("[VideoFeedCard] fullscreen toggle failed", err);
    }
  }, []);

  const handlePip = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current.requestPictureInPicture) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn("[VideoFeedCard] picture-in-picture failed", err);
    }
  }, []);

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
        if (cancelled || !videoRef.current) return;

        setVideoElement(videoRef.current);
        try {
          const stream = await startStream(agentWhepUrl!);
          if (cancelled) return;
          videoRef.current!.srcObject = stream;
          setConnecting(false);
          return;
        } catch (whepErr) {
          // DEC-108 Phase B0: if the direct WHEP fetch fails (cross-network
          // case — the browser can't reach the agent's LAN IP), fall back to
          // MQTT-relayed SDP signaling for a P2P WebRTC connection. Media
          // flows direct peer-to-peer via STUN-punched ICE after handshake.
          if (cancelled || !cloudDeviceId) throw whepErr;
          console.log("[VideoFeedCard] WHEP failed, trying P2P MQTT signaling:", whepErr);
          const stream = await startStreamViaMqttSignaling(cloudDeviceId);
          if (cancelled) return;
          videoRef.current!.srcObject = stream;
          setConnecting(false);
        }
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
      stopStream();
    };
  }, [agentWhepUrl, agentVideoState, retryKey, cloudDeviceId]);

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
      ref={containerRef}
      className={cn(
        "relative border border-border-default rounded-lg overflow-hidden bg-bg-secondary",
        // DEC-108 Phase D: in fullscreen the container expands to fill the
        // screen; switch to flex layout so the 16:9 aspect inner div can
        // scale up properly.
        isFullscreen && "flex items-center justify-center bg-black",
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

        {/* DEC-108 Phase D: transport pill (top-left) */}
        {hasVideo && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] font-mono text-text-secondary flex items-center gap-1.5 select-none">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                transport === "lan-whep" && "bg-green-400",
                transport === "cloud-whep" && "bg-blue-400",
                transport === "cloud-mse" && "bg-purple-400",
                transport === "p2p-mqtt" && "bg-yellow-400",
                transport === "unknown" && "bg-gray-500"
              )}
            />
            {transport === "lan-whep"
              ? "LAN DIRECT"
              : transport === "cloud-whep"
                ? "CLOUD WHEP"
                : transport === "cloud-mse"
                  ? "CLOUD MSE"
                  : transport === "p2p-mqtt"
                    ? "P2P MQTT"
                    : "—"}
          </div>
        )}

        {/* DEC-108 Phase D: video stats overlay (bottom) — extended with
            codec, bitrate, packet loss when available. Latency is color-coded:
              green < 100ms, yellow 100-300, orange 300-600, red > 600 */}
        {hasVideo && (
          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1 bg-black/60 backdrop-blur-sm text-[10px] font-mono text-text-secondary">
            <span>{fps > 0 ? `${fps} FPS` : "-- FPS"}</span>
            <span
              className={cn(
                latencyMs === 0 && "text-text-tertiary",
                latencyMs > 0 && latencyMs < 100 && "text-green-400",
                latencyMs >= 100 && latencyMs < 300 && "text-yellow-400",
                latencyMs >= 300 && latencyMs < 600 && "text-orange-400",
                latencyMs >= 600 && "text-red-400"
              )}
            >
              {latencyMs > 0 ? `${latencyMs}ms` : "--ms"}
            </span>
            <span>{resolution || "--\u00D7--"}</span>
            {codec && <span className="text-text-tertiary">{codec}</span>}
            {bitrateKbps > 0 && (
              <span className="text-text-tertiary">
                {bitrateKbps >= 1000
                  ? `${(bitrateKbps / 1000).toFixed(1)} Mbps`
                  : `${bitrateKbps} kbps`}
              </span>
            )}
            {packetsLost > 0 && (
              <span className="text-orange-400">{packetsLost} pkts lost</span>
            )}
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

      {/* DEC-108 Phase D: REC indicator (top-center, inside the video frame) */}
      {hasVideo && isRecording && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-mono font-semibold text-red-400 tracking-widest">
            REC
          </span>
        </div>
      )}

      {/* Top-right action buttons — DEC-108 Phase D: snapshot, record,
          PiP, fullscreen, reconnect, popout */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {hasVideo && (
          <>
            <button
              onClick={handleSnapshot}
              className="p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
              title="Capture screenshot"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRecordToggle}
              className={cn(
                "p-1 rounded bg-black/50 hover:bg-black/70 transition-colors",
                isRecording
                  ? "text-red-400 hover:text-red-300"
                  : "text-text-tertiary hover:text-text-primary"
              )}
              title={isRecording ? "Stop recording" : "Start recording"}
            >
              {isRecording ? (
                <Square className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Circle className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={handlePip}
              className="p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
              title="Picture in picture"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleFullscreenToggle}
              className="p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </>
        )}
        <button
          onClick={handleRetry}
          className="p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
          title="Reconnect video"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        {onPopOut && (
          <button
            onClick={onPopOut}
            className="p-1 rounded bg-black/50 hover:bg-black/70 text-text-tertiary hover:text-text-primary transition-colors"
            title="Pop out video"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
