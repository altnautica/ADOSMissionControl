"use client";

/**
 * @module MiniVideoView
 * @description Compact video thumbnail for the Drone Context Rail.
 * Shows live cloud video via MSE when available, placeholder otherwise.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { VideoOff } from "lucide-react";
import { useAgentStore } from "@/stores/agent-store";
import { useVideoStore } from "@/stores/video-store";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";

export function MiniVideoView() {
  const cloudMode = useAgentStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentStore((s) => s.cloudDeviceId);
  const cloudStreaming = useVideoStore((s) => s.cloudStreaming);
  const setCloudStreaming = useVideoStore((s) => s.setCloudStreaming);
  const clientConfig = useConvexSkipQuery(communityApi.clientConfig.get);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (!cloudMode || !cloudDeviceId || !videoRef.current) return;

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
