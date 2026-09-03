"use client";

/**
 * @module MiniVideoView
 * @description Compact video thumbnail for the Drone Context Rail.
 * Shows live video via WebRTC WHEP (direct mode) or MSE (cloud mode).
 *
 * The WHEP half goes through {@link useSingletonAgentVideo}, the same
 * connection brain the cockpit `VideoCanvas` and the focused-drone
 * `VideoFeedCard` use. It previously called `startStream()` off the barrel
 * directly with its own connect timeout and its own retry key, which made it
 * a fourth independent negotiation of a stream the other three were already
 * watching — and since `startStream` used to close the incumbent connection
 * first, mounting this rail blanked the cockpit. The session registry now
 * shares one connection per stream identity, but sharing it is not a reason
 * to keep a second path to it: this thumbnail also had no stall recovery and
 * no backoff, which the shared hook has.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoOff, Loader2 } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVideoStore } from "@/stores/video-store";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useSingletonAgentVideo } from "@/hooks/use-singleton-agent-video";

export function MiniVideoView() {
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const cloudStreaming = useVideoStore((s) => s.cloudStreaming);
  const setCloudStreaming = useVideoStore((s) => s.setCloudStreaming);
  const agentWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const transportMode = useSettingsStore((s) => s.videoTransportMode);
  const clientConfig = useConvexSkipQuery(communityApi.clientConfig.get);
  const playerRef = useRef<{ stop: () => void } | null>(null);

  // Callback ref so the cascade re-runs once the <video> element mounts. A
  // plain ref never triggers a render, so the hook would never see it.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);

  const session = useSingletonAgentVideo({
    whepUrl: agentWhepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
  });
  const directStreaming = session.state === "connected";
  const connecting = session.state === "connecting";

  // Cloud mode fallback: MSE player, only while WHEP is not carrying it.
  useEffect(() => {
    if (!cloudMode || !cloudDeviceId || !videoEl || directStreaming) return;

    let cancelled = false;

    async function startPlayer() {
      // Deliberately lazy, and kept lazy: the MSE player is only reachable
      // in cloud mode, so a static import would put its SourceBuffer
      // machinery in the bundle of every LAN-mode session that never
      // instantiates it.
      const { MsePlayer } = await import("@/lib/video/mse-player");
      if (cancelled || !videoEl) return;

      const player = new MsePlayer();
      playerRef.current = player;
      player.start(
        cloudDeviceId!,
        videoEl,
        clientConfig?.videoRelayUrl ?? undefined,
      );
      setCloudStreaming(true);
    }

    startPlayer();

    return () => {
      cancelled = true;
      playerRef.current?.stop();
      playerRef.current = null;
      setCloudStreaming(false);
    };
  }, [
    cloudMode,
    cloudDeviceId,
    videoEl,
    directStreaming,
    setCloudStreaming,
    clientConfig?.videoRelayUrl,
  ]);

  // Cloud mode rendering
  if (cloudMode && cloudDeviceId) {
    return (
      <div className="relative rounded border border-border-default bg-bg-tertiary overflow-hidden">
        <video
          ref={setVideoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-[112px] object-cover bg-black"
        />
        {!cloudStreaming && !directStreaming && (
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
          ref={setVideoRef}
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
