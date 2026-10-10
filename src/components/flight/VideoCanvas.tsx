"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useVideoStore } from "@/stores/video-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { CAMERA_RECOVERY_ACTIVE_STATES } from "@/lib/agent/camera-recovery";
import { useClockTick } from "@/lib/agent/freshness";
import {
  setVideoElement,
  startRecording as startVideoRecording,
  stopRecording as stopVideoRecording,
  captureScreenshot,
} from "@/lib/video/webrtc-client";
import { useSingletonAgentVideo } from "@/hooks/use-singleton-agent-video";
import { useResolvedAgentVideo } from "@/hooks/use-resolved-agent-video";
import { Badge } from "@/components/ui/badge";
import { formatElapsed, msSince } from "@/components/cockpit/band/format";
import { cn } from "@/lib/utils";
import { Camera, RefreshCw, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { VideoSourceConfigPanel } from "./VideoSourceConfigPanel";
import { useDemoFeedActive } from "@/components/cockpit/CockpitDemoStream";

interface VideoCanvasProps {
  children?: ReactNode;
  className?: string;
  /**
   * `panel` (default) draws the pane's own chrome: stats, source badge,
   * settings gear, REC control and indicator, and the frozen-picture band.
   * `cockpit` draws only the picture and its placeholder: the cockpit's
   * safety band, top-right cluster and frozen banner already carry every one
   * of those, and drawing them twice puts two answers on screen.
   */
  chrome?: "panel" | "cockpit";
  /** The drone whose feed this is. Keys the per-drone manual source override
   *  and unlocks the relayed-node WHEP fallback. Without it the pane plays the
   *  auto-discovered agent feed and offers no manual override. */
  droneId?: string;
}

/**
 * Which node is actually producing the picture, derived from which URL won
 * the resolution order below. A relayed feed (decoded by a ground station and
 * republished, with materially higher latency) must be distinguishable from a
 * direct one, and a missing feed must say whose camera is missing.
 */
type VideoSource = "manual" | "direct" | "relayed" | "cloud" | "none";

const SOURCE_KEY: Record<VideoSource, string | null> = {
  manual: "sourceManual",
  direct: "sourceDirect",
  relayed: "sourceRelayed",
  cloud: "sourceCloud",
  none: null,
};

/** Elapsed time of the video-only recording, ticking on the shared clock. */
function VideoRecElapsed({ startedAt }: { startedAt: number }) {
  useClockTick();
  return (
    <span className="text-[10px] font-mono text-status-error/80">
      {formatElapsed(msSince(startedAt))}
    </span>
  );
}

export function VideoCanvas({ children, className, chrome = "panel", droneId }: VideoCanvasProps) {
  const t = useTranslations("cockpit.video");
  const panelChrome = chrome === "panel";
  // In the cockpit a demo node's synthetic feed (a child of this pane) is the
  // picture: no placeholder over it and no real transport dialled behind it.
  const demoFeed = useDemoFeedActive(panelChrome ? undefined : droneId);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const isRecording = useVideoStore((s) => s.isRecording);
  const recordingStartedAt = useVideoStore((s) => s.recordingStartedAt);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);

  // The stream switcher's active concurrent leg wins over the poller-owned
  // default agent URL so a leg selection survives status polls.
  const whepUrlOverride = useVideoStore((s) => s.whepUrlOverride);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  // A relayed-only drone (reached through a ground station's WFB link, no
  // direct/cloud pairing) has an empty singleton store; the shared resolver
  // falls back to the funnelled feed on the drone's fleet-status row, for
  // the URL and for the reported state the retry and stall gates read.
  const {
    whepUrl: agentWhepUrl,
    funneledWhepUrl,
    videoState: agentVideoState,
  } = useResolvedAgentVideo(droneId);
  const singletonWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  const agentConnected = useAgentConnectionStore((s) => s.connected);
  const transportMode = useSettingsStore((s) => s.videoTransportMode);
  // Live air-side camera state: "missing" = the agent's pipeline found no
  // primary camera right now; an active recovery means a self-heal is in
  // flight.
  const liveCameraState = useAgentCapabilitiesStore((s) => s.cameraState);
  const cameraUsbRecovery = useAgentCapabilitiesStore((s) => s.cameraUsbRecovery);
  // A node with an empty camera roster has no video to be missing, so it gets
  // "no camera on this node" rather than a NO SIGNAL that implies a broken
  // link — the common case on a ground station.
  const hasCameraCapability = useAgentCapabilitiesStore((s) => s.cameras.length > 0);
  const degradedReason = useVideoStore((s) => s.degradedReason);

  // Per-drone manual override (SITL / Gazebo / forced URL), persisted in
  // drone metadata. When set it wins over the auto-discovered agent URL.
  const manualUrl = useDroneMetadataStore((s) =>
    droneId ? (s.profiles[droneId]?.videoWhepUrl ?? "") : "",
  );
  const upsertProfile = useDroneMetadataStore((s) => s.upsertProfile);

  // Manual override wins, then the stream switcher's selected concurrent leg,
  // then the auto-discovered default agent URL (which itself falls back to a
  // ground station's funnelled republish of this drone's downlink).
  const effectiveWhepUrl = manualUrl || whepUrlOverride || agentWhepUrl;

  const videoSource: VideoSource = manualUrl
    ? "manual"
    : whepUrlOverride || singletonWhepUrl
      ? agentConnected
        ? "direct"
        : "cloud"
      : funneledWhepUrl
        ? "relayed"
        : "none";

  // Callback ref so the cascade hook re-runs once the <video> element mounts;
  // a plain useRef never triggers a re-render.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);

  const [showConfig, setShowConfig] = useState(false);
  const [configUrl, setConfigUrl] = useState(manualUrl);

  // Bind the element to the webrtc-client singleton so screenshot / recording
  // and the stats loop (fps / latency / resolution) operate on it.
  useEffect(() => {
    setVideoElement(videoEl);
    return () => setVideoElement(null);
  }, [videoEl]);

  // The shared singleton-video brain owns the enable gate + transport cascade
  // + retry + stall recovery. A manual override URL forces a connect even when
  // the agent reports no running video.
  const {
    state: cascadeState,
    error: hookError,
    retry: handleRetry,
  } = useSingletonAgentVideo({
    whepUrl: effectiveWhepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
    forceEnabled: Boolean(manualUrl),
    suspended: demoFeed,
    agentVideoState,
  });

  const handleRecordToggle = useCallback(() => {
    if (isRecording) void stopVideoRecording();
    else startVideoRecording();
  }, [isRecording]);

  const handleSaveConfig = () => {
    if (droneId) upsertProfile(droneId, { videoWhepUrl: configUrl });
    setShowConfig(false);
  };

  const hasVideo = isStreaming;
  const showConnecting = cascadeState === "connecting" || agentVideoState === "starting";
  const cascadeError = cascadeState === "failed" ? hookError : null;
  const airCameraRecovering =
    cameraUsbRecovery != null && CAMERA_RECOVERY_ACTIVE_STATES.has(cameraUsbRecovery.state);
  const airCameraMissing = liveCameraState === "missing";

  // An agent is present when the drone's companion is connected LAN-direct,
  // reachable over the cloud relay, or a ground station is funnelling its
  // downlink. Then the video is the agent's job and the manual prompt never
  // appears; it is only for a drone with no agent at all (FC-only / SITL).
  const agentPresent = agentConnected || Boolean(cloudDeviceId) || Boolean(funneledWhepUrl);
  const offerManualConfig = Boolean(droneId) && !agentPresent && !effectiveWhepUrl;

  // Each branch names a distinct condition: a down radio link, a drone that
  // is not streaming, and a node with no camera are different situations.
  const placeholderKey = showConnecting
    ? "connecting"
    : airCameraRecovering
      ? "cameraRecovering"
      : airCameraMissing
        ? "noCamera"
        : videoSource === "none"
          ? hasCameraCapability
            ? "noVideoSource"
            : "noCameraOnNode"
          : cascadeError
            ? videoSource === "relayed"
              ? "noSignalGround"
              : "noSignal"
            : agentVideoState === "running"
              ? "noSignal"
              : agentPresent
                ? "videoOffline"
                : "noSignal";

  const sourceKey = SOURCE_KEY[videoSource];
  const sourceBadge = sourceKey ? t(sourceKey) : null;

  return (
    <div className={cn("relative w-full h-full bg-bg-primary overflow-hidden", className)}>
      <video
        ref={setVideoRef}
        autoPlay
        muted
        playsInline
        className={cn("absolute inset-0 w-full h-full object-contain", !hasVideo && "hidden")}
      />

      {!hasVideo && !demoFeed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 border border-border-default flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-text-tertiary"
              >
                <path d="M1 1l22 22M21 10.5V5a2 2 0 00-2-2H5" />
                <path d="M10.5 5H19a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7" />
              </svg>
            </div>
            <span className="text-sm font-mono text-text-tertiary tracking-wider">
              {t(placeholderKey)}
            </span>
            {/* Which node the absent video belongs to. */}
            {sourceBadge && (
              <span
                className="text-[10px] font-mono tracking-wider text-text-tertiary"
                data-video-source={videoSource}
              >
                {sourceBadge}
              </span>
            )}
            {cascadeError && (
              <span className="text-[10px] text-status-error max-w-[200px] text-center">
                {cascadeError}
              </span>
            )}
            {cascadeError && !showConfig && (
              <button
                onClick={handleRetry}
                className="pointer-events-auto mt-1 flex items-center gap-1 px-3 py-1.5 text-[10px] font-mono text-text-secondary border border-border-default hover:border-accent-primary hover:text-accent-primary transition-colors cursor-pointer"
              >
                <RefreshCw size={11} />
                {t("retry")}
              </button>
            )}
            {offerManualConfig && !showConfig && (
              <button
                onClick={() => { setConfigUrl(""); setShowConfig(true); }}
                className="pointer-events-auto mt-2 px-3 py-1.5 text-[10px] font-mono text-text-secondary border border-border-default hover:border-accent-primary hover:text-accent-primary transition-colors cursor-pointer"
              >
                {t("configure")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* The receive path is still installed and the last frame is still on
          screen, but nothing is arriving. The cockpit draws its own banner. */}
      {panelChrome && hasVideo && degradedReason && (
        <div
          className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-status-error/85 px-2 py-1"
          data-video-degraded={degradedReason}
          role="status"
        >
          <span className="text-[11px] font-mono font-semibold tracking-wider text-on-status">
            {degradedReason === "ice-disconnect" ? t("frozenLinkLost") : t("frozenNoFrames")}
          </span>
        </div>
      )}

      {showConfig && (
        <VideoSourceConfigPanel
          url={configUrl}
          onUrlChange={setConfigUrl}
          onSave={handleSaveConfig}
          onClose={() => setShowConfig(false)}
        />
      )}

      {panelChrome && isRecording && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-status-error motion-safe:animate-pulse" />
          <span className="text-xs font-mono font-semibold text-status-error tracking-wider">REC</span>
          {recordingStartedAt !== null && <VideoRecElapsed startedAt={recordingStartedAt} />}
        </div>
      )}

      {hasVideo && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1">
          {panelChrome && (
            <button
              onClick={handleRecordToggle}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-semibold rounded transition-colors cursor-pointer",
                isRecording
                  ? "bg-status-error/20 text-status-error border border-status-error/40 hover:bg-status-error/30"
                  : "bg-bg-primary/80 text-text-secondary border border-border-default hover:text-text-primary hover:bg-bg-primary"
              )}
              title={isRecording ? "Stop recording video" : "Record video"}
            >
              <span className={cn("w-2 h-2 rounded-full", isRecording ? "bg-status-error motion-safe:animate-pulse" : "bg-status-error/60")} />
              {isRecording ? "STOP" : "REC"}
            </button>
          )}
          <button
            onClick={() => captureScreenshot()}
            className="pointer-events-auto flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-text-secondary bg-bg-primary/80 border border-border-default rounded hover:text-text-primary hover:bg-bg-primary transition-colors cursor-pointer"
            title="Capture screenshot"
          >
            <Camera size={10} />
          </button>
        </div>
      )}

      {panelChrome && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {/* DIRECT and VIA GROUND are different latencies; name the source. */}
          {hasVideo && sourceBadge && (
            <Badge variant="neutral" size="sm" data-video-source={videoSource}>
              {sourceBadge}
            </Badge>
          )}
          <Badge variant="neutral" size="sm">
            {resolution || "—"}
          </Badge>
          <Badge variant={fps !== null && fps > 0 ? "success" : "neutral"} size="sm">
            {fps === null ? "—" : fps} FPS
          </Badge>
          {/* Explicitly `net`: RTT plus decoder buffer wait, not glass-to-glass. */}
          <Badge
            variant={latencyMs === null ? "neutral" : latencyMs > 200 ? "warning" : "success"}
            size="sm"
          >
            {latencyMs === null ? "—" : latencyMs}ms net
          </Badge>
          {droneId && (
            <button
              onClick={() => { setConfigUrl(manualUrl); setShowConfig(!showConfig); }}
              className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
              title="Video source settings"
            >
              <Settings2 size={14} />
            </button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
