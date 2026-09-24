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
import { useAction } from "convex/react";
import { VideoOff, Loader2 } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVideoStore } from "@/stores/video-store";
import { communityApi } from "@/lib/community-api";
import { cmdVideoRelayTokensApi } from "@/lib/community-api-drones";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useSingletonAgentVideo } from "@/hooks/use-singleton-agent-video";
import { useResolvedAgentVideo } from "@/hooks/use-resolved-agent-video";

export function MiniVideoView() {
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const cloudStreaming = useVideoStore((s) => s.cloudStreaming);
  const setCloudStreaming = useVideoStore((s) => s.setCloudStreaming);
  // Singleton store, else the funnelled feed a paired ground station relays.
  const { whepUrl: agentWhepUrl, videoState: agentVideoState } =
    useResolvedAgentVideo(cloudDeviceId);
  const transportMode = useSettingsStore((s) => s.videoTransportMode);
  const clientConfig = useConvexSkipQuery(communityApi.clientConfig.get);
  const mintRelayToken = useAction(cmdVideoRelayTokensApi.mint);
  const playerRef = useRef<{ stop: () => void } | null>(null);
  // The real cloud-relay failure reason, or null. The MSE player reported
  // every one of `mse-unsupported` / `codec-unknown` / `codec-unsupported` /
  // `source-buffer-rejected` to the console only, because this surface passed
  // no `onError` — so a relay that was unreachable and a camera that was off
  // looked identical: a black rectangle with `cloudStreaming` reading true.
  const [cloudError, setCloudError] = useState<string | null>(null);

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
    agentVideoState,
  });
  const directStreaming = session.state === "connected";
  const connecting = session.state === "connecting";

  // Cloud mode fallback: MSE player, only while WHEP is not carrying it.
  useEffect(() => {
    if (!cloudMode || !cloudDeviceId || !videoEl || directStreaming) return;
    const deviceId = cloudDeviceId;

    let cancelled = false;
    const el = videoEl;
    setCloudError(null);

    // `cloudStreaming` is set from the element's own `playing` event, never
    // from construction. It used to be set synchronously right after
    // `player.start()` — before a socket opened, before a byte was decoded,
    // before a codec was known — which removed the only placeholder this
    // surface had and published a fabricated live state to the whole app.
    const onPlaying = () => {
      if (cancelled) return;
      setCloudError(null);
      setCloudStreaming(true);
    };
    // The player resets the element (`src = ''`) on every relay reconnect and
    // stall recovery, which fires `emptied`; a starved buffer fires `waiting`.
    // Either way no frame is arriving, so the tile goes back to CONNECTING
    // until `playing` fires again instead of sitting black as "streaming".
    const onNoFrames = () => {
      if (cancelled) return;
      setCloudStreaming(false);
    };
    el.addEventListener("playing", onPlaying);
    el.addEventListener("emptied", onNoFrames);
    el.addEventListener("waiting", onNoFrames);

    async function startPlayer() {
      // Deliberately lazy, and kept lazy: the MSE player is only reachable
      // in cloud mode, so a static import would put its SourceBuffer
      // machinery in the bundle of every LAN-mode session that never
      // instantiates it.
      const { MsePlayer } = await import("@/lib/video/mse-player");
      if (cancelled) return;

      const player = new MsePlayer();
      playerRef.current = player;
      player.start(
        deviceId,
        el,
        clientConfig?.videoRelayUrl ?? undefined,
        {
          onError: (err) => {
            if (cancelled) return;
            setCloudStreaming(false);
            setCloudError(err.message);
          },
          // The relay opens a stream only for an owner-minted, short-lived
          // token. The player asks for a fresh one before every dial, so a
          // reconnect never presents an expired token.
          getRelayToken: async () => {
            const result = await mintRelayToken({ deviceId }).catch(() => null);
            if (!result) throw new Error("Could not authorize cloud video for this drone");
            if (result.status === "not-configured") {
              throw new Error("Cloud video relay is not configured");
            }
            return result.token;
          },
        },
      );
    }

    startPlayer();

    return () => {
      cancelled = true;
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("emptied", onNoFrames);
      el.removeEventListener("waiting", onNoFrames);
      playerRef.current?.stop();
      playerRef.current = null;
      setCloudStreaming(false);
      setCloudError(null);
    };
  }, [
    cloudMode,
    cloudDeviceId,
    videoEl,
    directStreaming,
    setCloudStreaming,
    clientConfig?.videoRelayUrl,
    mintRelayToken,
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
          className="w-full h-[112px] object-cover bg-media"
        />
        {!cloudStreaming && !directStreaming && (
          <div className="absolute inset-0 flex items-center justify-center p-1 text-text-tertiary">
            <div className="flex flex-col items-center gap-1 text-center">
              <VideoOff
                size={18}
                className={cloudError ? "text-status-error" : undefined}
              />
              {cloudError ? (
                <span className="text-[9px] leading-tight text-status-error">
                  {cloudError}
                </span>
              ) : (
                <span className="text-[10px]">CONNECTING...</span>
              )}
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
          className="w-full h-[112px] object-cover bg-media"
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
