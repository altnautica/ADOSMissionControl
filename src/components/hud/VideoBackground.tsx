"use client";

// HUD video background. Full-viewport WebRTC/WHEP feed. Reuses the same
// cascade hook and webrtc-client helpers as VideoFeedCard, but renders a
// bare <video> element sized to cover the kiosk display with no chrome.
// Supports DEC-109 Phase H transports: LAN Direct WHEP and P2P MQTT.

import { useCallback, useMemo, useRef, useState } from "react";
import { useVideoStore } from "@/stores/video-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVideoTransportCascade } from "@/hooks/use-video-transport-cascade";

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

  // Stabilize enabled: require 3 consecutive non-running polls before
  // disabling the cascade. Mirrors VideoFeedCard so a flaky agent probe
  // does not kill a healthy WebRTC session on the kiosk.
  const nonRunningCountRef = useRef(0);
  const stableEnabled = useMemo(() => {
    if (agentVideoState === "running") {
      nonRunningCountRef.current = 0;
      return true;
    }
    nonRunningCountRef.current += 1;
    return nonRunningCountRef.current < 3;
  }, [agentVideoState]);

  const cascade = useVideoTransportCascade({
    agentWhepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
    retryKey: 0,
    enabled: stableEnabled,
  });

  const hasVideo = isStreaming;
  const connecting = cascade.state === "connecting" || agentVideoState === "starting";

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
            : cascade.state === "failed"
              ? "video link down"
              : "no video signal"}
        </div>
      )}
    </div>
  );
}
