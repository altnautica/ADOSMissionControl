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
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useSurfaceGate } from "@/hooks/use-surface-gate";
import { useVideoStore } from "@/stores/video-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { CAMERA_RECOVERY_ACTIVE_STATES } from "@/lib/agent/camera-recovery";
// Static import for webrtc-client. Dynamic
// imports inside useEffect were causing Turbopack to HMR-reload the
// module on every unrelated edit, wiping module-level stats state and
// orphaning the active RTCPeerConnection. Static import puts the module
// in the parent's import graph so HMR only invalidates it on direct
// edits to webrtc-client.ts itself.
import {
  setVideoElement,
  captureScreenshot,
  startRecording,
  stopRecording,
} from "@/lib/video/webrtc-client";
// Shared singleton-video connection brain (gate + cascade + retry + stall).
// The Fly pane uses the exact same hook so the two surfaces can't diverge.
import { useSingletonAgentVideo } from "@/hooks/use-singleton-agent-video";
import { VideoTransportSwitcher } from "./VideoTransportSwitcher";
import { VideoLatencyBreakdown } from "./VideoLatencyBreakdown";
import { useVideoLatencyPoll } from "@/hooks/use-video-latency-poll";
import { useDroneClockOffset } from "@/hooks/use-drone-clock-offset";
import { resolveAgentVideoUrl } from "@/lib/agent/video-url";
import { useCommandFleetStore } from "@/stores/command-fleet-store";

interface VideoFeedCardProps {
  className?: string;
  onPopOut?: () => void;
}

export function VideoFeedCard({ className, onPopOut }: VideoFeedCardProps) {
  const singletonWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  const singletonVideoState = useVideoStore((s) => s.agentVideoState);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);
  // Extended stats + transport indicator
  const codec = useVideoStore((s) => s.codec);
  const bitrateKbps = useVideoStore((s) => s.bitrateKbps);
  const packetsLost = useVideoStore((s) => s.packetsLost);
  const isRecording = useVideoStore((s) => s.isRecording);
  // Rich breakdown — used in the bottom strip chip and the popover.
  const airLatencyMs = useVideoStore((s) => s.latency.airLatencyMs);
  const trueG2GMs = useVideoStore((s) => s.latency.trueG2GMs);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);

  // The singleton video store is filled by the LAN poll or a cloud heartbeat.
  // A node reached through another node (a drone linked to a paired ground
  // station over the radio) has neither, so the store stays empty and the pane
  // rendered "AGENT VIDEO STOPPED" over a feed that was in fact already on the
  // ground: the ground station decodes the drone's downlink into its own
  // mediamtx, and the per-node status row carries that playable URL. Fall back
  // to it so the funneled feed reaches this pane, not just the fleet grid.
  const nodeStatus = useCommandFleetStore((s) =>
    cloudDeviceId ? s.cloudStatuses[cloudDeviceId] : undefined,
  );
  const funneledWhepUrl = resolveAgentVideoUrl(nodeStatus);
  const agentWhepUrl = singletonWhepUrl ?? funneledWhepUrl;
  // Same for the reported state: "unknown" from an unpopulated store would
  // otherwise read as stopped even while the funneled feed is running.
  const agentVideoState =
    singletonVideoState && singletonVideoState !== "unknown"
      ? singletonVideoState
      : (nodeStatus?.videoState ?? singletonVideoState);
  // Live air-side camera state for the focused drone (distinct from the
  // static capability catalog). "missing" means the agent's video
  // pipeline found no primary camera right now; the recovery block, when
  // in an active state, means a self-heal is in flight.
  const liveCameraState = useAgentCapabilitiesStore((s) => s.cameraState);
  const cameraUsbRecovery = useAgentCapabilitiesStore(
    (s) => s.cameraUsbRecovery,
  );
  // User transport preference (persisted to IndexedDB)
  const transportMode = useSettingsStore((s) => s.videoTransportMode);

  // Air-side SEI poll (1Hz) + drone↔browser clock-offset poll (30s).
  // Both are no-ops when the agent isn't paired / video isn't running,
  // and they synthesise values in demo mode so the popover always
  // renders.
  useVideoLatencyPoll();
  useDroneClockOffset();

  // Callback ref for the video element. The previous useRef-only pattern
  // caused the cascade hook to receive `videoEl: null` on first render
  // and never re-trigger when the ref attached, because refs don't cause
  // re-renders. The callback ref calls setState when the element mounts,
  // which DOES trigger a re-render and lets the cascade hook see the
  // element on the next pass.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);

  // Video action buttons. The actual capture/record/PiP logic already
  // exists in webrtc-client.ts (captureScreenshot, startRecording,
  // stopRecording). These handlers just wire UI buttons to those helpers
  // and add fullscreen / picture-in-picture using the standard browser
  // APIs on the underlying <video> element.

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
    if (!videoEl) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoEl.requestPictureInPicture) {
        await videoEl.requestPictureInPicture();
      }
    } catch (err) {
      console.warn("[VideoFeedCard] picture-in-picture failed", err);
    }
  }, [videoEl]);

  // Bind the video element to the webrtc-client helper
  // (used by snapshot/recording). Re-binds when the element changes.
  useEffect(() => {
    setVideoElement(videoEl);
    return () => setVideoElement(null);
  }, [videoEl]);

  // Live-edge catch-up removed: WebRTC manages its own playout timing via
  // the jitter buffer. The previous timer did video.currentTime seeks and
  // playbackRate changes that broke the H.264 decoder chain, causing video
  // freezes. mediamtx's built-in test page (no catchup logic) streams
  // indefinitely without issues — confirming the timer was the problem.

  // The shared singleton-video brain owns the enable gate + transport cascade
  // + indefinite retry + stall recovery. The Fly pane uses the identical hook,
  // so the two surfaces can never diverge.
  const {
    state: cascadeState,
    activeTransport,
    error: cascadeError,
    retry: handleRetry,
    retryDelaySec,
  } = useSingletonAgentVideo({
    whepUrl: agentWhepUrl,
    cloudDeviceId,
    transportMode,
    videoEl,
  });

  const hasVideo = isStreaming;
  const cameraGate = useSurfaceGate("capability:camera");
  const noCamera = cameraGate.mode === "capability-missing";
  const tLink = useTranslations("linkUp");
  const showConnecting = cascadeState === "connecting" || agentVideoState === "starting";
  // Live air-side states, distinct from the static capability catalog.
  // A camera the agent reports missing right now (vs. a board the catalog
  // says never had one), and an in-flight self-heal. The recovering case
  // wins over the plain "missing" case so the operator sees the agent is
  // already acting on it.
  const airCameraRecovering =
    cameraUsbRecovery != null &&
    CAMERA_RECOVERY_ACTIVE_STATES.has(cameraUsbRecovery.state);
  const airCameraMissing = liveCameraState === "missing";
  const showAirSideCamera =
    (airCameraMissing || airCameraRecovering) && !hasVideo;
  const showNoSignal =
    !hasVideo &&
    !showConnecting &&
    cascadeState !== "failed" &&
    !noCamera &&
    !showAirSideCamera;
  const error = cascadeState === "failed" ? cascadeError : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative border border-border-default rounded-lg overflow-hidden bg-bg-secondary",
        // In fullscreen the container expands to fill the
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
          ref={setVideoRef}
          autoPlay
          muted
          playsInline
          className={cn(
            "absolute inset-0 w-full h-full object-cover bg-black",
            !hasVideo && "hidden"
          )}
        />

        {/* Interactive transport switcher (always rendered, not gated on
            hasVideo so users can pin a mode before video starts). Surfaces
            agentVideoState so the dropdown can show "Agent video stopped"
            instead of a misleading mode label. Surfaces retryDelaySec so
            the pill can show "retrying in Xs" instead of flickering between
            FAILED and CONNECTING. */}
        <VideoTransportSwitcher
          activeTransport={activeTransport}
          cascadeState={cascadeState}
          cascadeError={cascadeError}
          onRetry={handleRetry}
          hasPairedAgent={!!cloudDeviceId}
          hasLanWhep={!!agentWhepUrl}
          agentVideoState={agentVideoState}
          retryDelaySec={retryDelaySec}
        />


        {/* Video stats overlay (bottom) with codec, bitrate, packet loss
            when available. The latency chip is the trigger for the
            breakdown popover; hover/click expands the full attribution
            (capture, encode, network, decode, present). Color bucket is
            computed over the largest available value so an unhealthy
            air leg can't be masked by a healthy link leg. */}
        {hasVideo && (() => {
          const link = latencyMs;
          const air =
            airLatencyMs != null && airLatencyMs > 0
              ? Math.round(airLatencyMs)
              : null;
          const g2g =
            trueG2GMs != null && trueG2GMs > 0
              ? Math.round(trueG2GMs)
              : null;
          const worst = Math.max(link, air ?? 0, g2g ?? 0);
          const colorClass =
            worst === 0
              ? "text-text-tertiary"
              : worst < 100
                ? "text-status-success"
                : worst < 300
                  ? "text-status-warning"
                  : worst < 600
                    ? "text-status-serious"
                    : "text-status-error";
          return (
            <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1 bg-black/60 backdrop-blur-sm text-[10px] font-mono text-text-secondary">
              <span>{fps > 0 ? `${fps} FPS` : "-- FPS"}</span>
              <VideoLatencyBreakdown
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-1 -mx-1",
                  "hover:bg-white/5 transition-colors",
                  colorClass,
                )}
              >
                <span>{link > 0 ? `LINK ${link}ms` : "LINK --"}</span>
                {air !== null && (
                  <span className="text-text-tertiary">
                    {"\u00B7"} AIR <span className={colorClass}>{air}ms</span>
                  </span>
                )}
                {g2g !== null && (
                  <span className="text-text-tertiary">
                    {"\u00B7"} G2G <span className={colorClass}>{g2g}ms</span>
                  </span>
                )}
              </VideoLatencyBreakdown>
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
                <span className="text-status-serious">{packetsLost} pkts lost</span>
              )}
            </div>
          );
        })()}

        {/* No signal placeholder — z-10 so transport switcher (z-20) stays on top */}
        {showNoSignal && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0a0a0f]">
            <CameraOff className="w-8 h-8 text-text-tertiary" />
            <span className="text-xs text-text-tertiary font-mono tracking-widest">
              NO SIGNAL
            </span>
          </div>
        )}

        {/* No camera in the static capability catalog — distinct from "no
            signal" so the operator knows to attach a camera, not debug the
            link. Suppressed when the live air-side overlay is showing so the
            two never stack. */}
        {noCamera && !hasVideo && !showAirSideCamera && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-[#0a0a0f] p-4 text-center">
            <CameraOff className="w-8 h-8 text-text-tertiary" />
            <span className="text-xs font-medium text-text-secondary">
              {tLink("no-camera.title")}
            </span>
            <span className="max-w-[18rem] text-[11px] leading-relaxed text-text-tertiary">
              {tLink("no-camera.body")}
            </span>
          </div>
        )}

        {/* Live air-side camera state — the agent reports the primary camera
            missing (or is actively self-healing it) right now. Distinct from
            the static catalog overlay above: this is a runtime condition the
            operator can fix by reseating the USB camera, and it self-clears
            when the agent recovers the camera. */}
        {showAirSideCamera && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-[#0a0a0f] p-4 text-center">
            {airCameraRecovering ? (
              <>
                <Loader2 className="w-7 h-7 text-accent-primary animate-spin" />
                <span className="text-xs font-medium text-text-secondary">
                  {tLink("no-camera.recovering.title")}
                </span>
              </>
            ) : (
              <>
                <CameraOff className="w-8 h-8 text-status-warning" />
                <span className="text-xs font-medium text-text-secondary">
                  {tLink("no-camera.air-side.title")}
                </span>
                <span className="max-w-[18rem] text-[11px] leading-relaxed text-text-tertiary">
                  {tLink("no-camera.air-side.body")}
                </span>
              </>
            )}
          </div>
        )}

        {/* Connecting state — z-10 so transport switcher (z-20) stays on top */}
        {showConnecting && !hasVideo && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0a0a0f]">
            <Loader2 className="w-6 h-6 text-accent-primary animate-spin" />
            <span className="text-xs text-text-tertiary font-mono tracking-widest">
              CONNECTING...
            </span>
          </div>
        )}

        {/* Error state with retry — z-10 so the transport switcher
            (z-20) stays clickable on top of this overlay. */}
        {error && !hasVideo && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0a0a0f]">
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

      </div>

      {/* REC indicator (top-center, inside the video frame) */}
      {hasVideo && isRecording && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-status-error animate-pulse" />
          <span className="text-[10px] font-mono font-semibold text-status-error tracking-widest">
            REC
          </span>
        </div>
      )}

      {/* Top-right action buttons: snapshot, record, PiP, fullscreen,
          reconnect, popout. */}
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
                  ? "text-status-error hover:text-status-error/80"
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
