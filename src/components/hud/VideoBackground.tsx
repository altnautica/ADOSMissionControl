"use client";

// HUD video background. Full-viewport WebRTC/WHEP feed rendered as a bare
// <video> element sized to cover the kiosk display with no chrome. Supports
// two transports: LAN Direct WHEP and P2P MQTT.
//
// Connection handling is `useSingletonAgentVideo`, the same brain the cockpit
// VideoCanvas and the focused-drone VideoFeedCard use. This file used to call
// `useVideoTransportCascade` directly and re-implement the three things the
// shared hook wraps around it — the 3-strike `enabled` debounce, the
// indefinite failure backoff, and the frozen-stream re-cascade — with its own
// copies of the delay constants. Three implementations of one policy is three
// places for the kiosk to diverge from the cockpit, which is precisely the
// divergence that hook was extracted to end. The kiosk's requirements are
// already the hook's defaults: it retries indefinitely because there is no
// operator to press retry, and the hook has no attempt cap.

import { useCallback, useState } from "react";
import { useVideoStore } from "@/stores/video-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useSingletonAgentVideo } from "@/hooks/use-singleton-agent-video";

export function VideoBackground() {
  const agentWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const transportMode = useSettingsStore((s) => s.videoTransportMode);

  // Callback ref so the cascade hook re-runs once the <video> mounts.
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

  const hasVideo = isStreaming;
  const connecting =
    session.state === "connecting" || agentVideoState === "starting";

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={setVideoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover bg-black"
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center text-white/30 text-xs font-mono uppercase tracking-widest pointer-events-none">
          {connecting
            ? "connecting video..."
            : session.state === "failed"
              ? "video link down"
              : "no video signal"}
        </div>
      )}
    </div>
  );
}
