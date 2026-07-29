"use client";

import { useState, useEffect, useCallback } from "react";
import { useVideoStore } from "@/stores/video-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { resolveAgentVideoUrl } from "@/lib/agent/video-url";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { CAMERA_RECOVERY_ACTIVE_STATES } from "@/lib/agent/camera-recovery";
import {
  setVideoElement,
  startRecording as startVideoRecording,
  stopRecording as stopVideoRecording,
  captureScreenshot,
} from "@/lib/video/webrtc-client";
import { useSingletonAgentVideo } from "@/hooks/use-singleton-agent-video";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Camera, RefreshCw, Settings2, X } from "lucide-react";
import type { ReactNode } from "react";

interface VideoCanvasProps {
  children?: ReactNode;
  className?: string;
  /** Hide the built-in video REC button. The cockpit provides a single unified
   *  flight-recording control (video + telemetry), so the per-pane video-only
   *  REC would be a duplicate there; the screenshot control is kept. */
  hideRecordButton?: boolean;
  /** The focused drone's canonical device id. Optional so existing direct-node
   *  callers (e.g. DroneVisionTab) are unaffected; when present it unlocks the
   *  relayed-node WHEP fallback below (Cockpit passes it). */
  droneId?: string;
}

const WHEP_PRESETS = [
  { label: "Gazebo SITL", url: "http://localhost:8889/gazebo-cam/whep" },
  { label: "Agent (local)", url: "http://192.168.1.50:8889/stream/whep" },
];

export function VideoCanvas({ children, className, hideRecordButton = false, droneId }: VideoCanvasProps) {
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const isRecording = useVideoStore((s) => s.isRecording);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);

  // Auto-discovered agent video. The LAN poll (/api/status/full) and the
  // cloud heartbeat (cmd_droneStatus) both populate these via
  // setAgentVideoStatus, so the focused drone's stream URL is already known
  // here — no manual configuration needed.
  const agentWhepUrl = useVideoStore((s) => s.agentWhepUrl);
  // The stream switcher's active concurrent leg (wins over the poller-owned
  // default `agentWhepUrl` so a leg selection survives status polls).
  const whepUrlOverride = useVideoStore((s) => s.whepUrlOverride);
  const agentVideoState = useVideoStore((s) => s.agentVideoState);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  // The singleton video store is filled by the LAN poll or a cloud
  // heartbeat. A relayed-only drone (reached through a ground station's WFB
  // link, no direct/cloud pairing) has neither, so the store stays empty
  // even though the ground station already decoded the drone's downlink
  // into its own mediamtx `main` path and published that playable URL onto
  // the drone's funneled fleet-status row (relayed-peers.ts::funneledStatusFor).
  // Fall back to it — same pattern as VideoFeedCard — so the Cockpit pane
  // shows the funneled feed instead of a permanent NO SIGNAL.
  const funneledNodeStatus = useCommandFleetStore((s) =>
    droneId ? s.cloudStatuses[droneId] : undefined,
  );
  const funneledWhepUrl = resolveAgentVideoUrl(funneledNodeStatus);
  const resolvedAgentVideoState =
    agentVideoState && agentVideoState !== "unknown"
      ? agentVideoState
      : (funneledNodeStatus?.videoState ?? agentVideoState);
  const agentConnected = useAgentConnectionStore((s) => s.connected);
  const transportMode = useSettingsStore((s) => s.videoTransportMode);
  // Live air-side camera state for the focused drone (distinct from the
  // static capability catalog): "missing" = the agent's pipeline found no
  // primary camera right now; an active recovery means a self-heal is in
  // flight.
  const liveCameraState = useAgentCapabilitiesStore((s) => s.cameraState);
  const cameraUsbRecovery = useAgentCapabilitiesStore(
    (s) => s.cameraUsbRecovery,
  );

  // Per-drone manual override (SITL / Gazebo / forced URL), persisted in
  // drone metadata. When set it wins over the auto-discovered agent URL.
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const droneProfile = useDroneMetadataStore((s) =>
    selectedDroneId ? s.profiles[selectedDroneId] : undefined,
  );
  const upsertProfile = useDroneMetadataStore((s) => s.upsertProfile);
  const manualUrl = droneProfile?.videoWhepUrl ?? "";
  const setVideoWhepUrl = (url: string) => {
    if (selectedDroneId) {
      upsertProfile(selectedDroneId, { videoWhepUrl: url });
    }
  };

  // Manual override wins, then the stream switcher's selected concurrent leg,
  // then the auto-discovered default agent URL.
  const effectiveWhepUrl =
    manualUrl || whepUrlOverride || agentWhepUrl || funneledWhepUrl;

  // Callback ref so the cascade hook re-runs once the <video> element mounts.
  // A plain useRef never triggers a re-render, so the cascade would see
  // videoEl: null forever (see VideoFeedCard for the same pattern).
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);

  const [showConfig, setShowConfig] = useState(false);
  const [configUrl, setConfigUrl] = useState(manualUrl);

  // Recording timer
  const [recElapsed, setRecElapsed] = useState("");

  // Bind the element to the webrtc-client singleton so screenshot / recording
  // and the stats loop (fps / latency / resolution) operate on it.
  useEffect(() => {
    setVideoElement(videoEl);
    return () => setVideoElement(null);
  }, [videoEl]);

  useEffect(() => {
    if (!isRecording) {
      setRecElapsed("");
      return;
    }
    const startTime = Date.now();
    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setRecElapsed(`${m}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  // The shared singleton-video brain owns the enable gate + transport cascade
  // + retry + stall recovery — identical to the Agent-tab feed, so the Fly
  // pane can never diverge from it. A manual override URL (SITL/Gazebo) forces
  // a connect even when the agent reports no running video.
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
  });

  const handleRecordToggle = useCallback(() => {
    if (isRecording) {
      stopVideoRecording();
    } else {
      startVideoRecording();
    }
  }, [isRecording]);

  const handleScreenshot = useCallback(() => {
    captureScreenshot();
  }, []);

  const handleSaveConfig = () => {
    setVideoWhepUrl(configUrl);
    setShowConfig(false);
  };

  const hasVideo = isStreaming;
  const showConnecting =
    cascadeState === "connecting" || agentVideoState === "starting";
  const cascadeError = cascadeState === "failed" ? hookError : null;
  const airCameraRecovering =
    cameraUsbRecovery != null &&
    CAMERA_RECOVERY_ACTIVE_STATES.has(cameraUsbRecovery.state);
  const airCameraMissing = liveCameraState === "missing";

  // An agent is present when the focused drone's companion is connected
  // LAN-direct, reachable over the cloud relay, or — for a WFB-relayed drone
  // with no direct/cloud pairing at all — the ground station is already
  // funneling its downlink (funneledWhepUrl). When an agent is present the
  // video is ITS job — so we never fall back to the manual "Configure
  // Video Source" prompt; we auto-render its stream, or show its real state
  // (camera recovery / missing / offline) instead. The manual prompt only
  // appears for a drone with no agent at all (FC-only / SITL).
  const agentPresent =
    agentConnected || Boolean(cloudDeviceId) || Boolean(funneledWhepUrl);
  const offerManualConfig = !agentPresent && !effectiveWhepUrl;

  const placeholderLabel = showConnecting
    ? "CONNECTING..."
    : airCameraRecovering
      ? "CAMERA RECOVERING..."
      : airCameraMissing
        ? "NO CAMERA"
        : cascadeError
          ? "NO SIGNAL"
          : agentPresent
            ? resolvedAgentVideoState === "running"
              ? "NO SIGNAL"
              : "VIDEO OFFLINE"
            : effectiveWhepUrl
              ? "NO SIGNAL"
              : "NO VIDEO SOURCE";

  return (
    <div
      className={cn(
        "relative w-full h-full bg-bg-primary overflow-hidden",
        className
      )}
    >
      {/* Video element (always rendered, hidden when not streaming) */}
      <video
        ref={setVideoRef}
        autoPlay
        muted
        playsInline
        className={cn(
          "absolute inset-0 w-full h-full object-contain",
          !hasVideo && "hidden"
        )}
      />

      {/* Placeholder (no live signal) */}
      {!hasVideo && (
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
              {placeholderLabel}
            </span>
            {cascadeError && (
              <span className="text-[10px] text-status-error max-w-[200px] text-center">
                {cascadeError}
              </span>
            )}
            {cascadeError && !showConfig && (
              <button
                onClick={handleRetry}
                className="mt-1 flex items-center gap-1 px-3 py-1.5 text-[10px] font-mono text-text-secondary border border-border-default hover:border-accent-primary hover:text-accent-primary transition-colors cursor-pointer"
              >
                <RefreshCw size={11} />
                RETRY
              </button>
            )}
            {offerManualConfig && !showConfig && (
              <button
                onClick={() => { setConfigUrl(""); setShowConfig(true); }}
                className="mt-2 px-3 py-1.5 text-[10px] font-mono text-text-secondary border border-border-default hover:border-accent-primary hover:text-accent-primary transition-colors cursor-pointer"
              >
                Configure Video Source
              </button>
            )}
          </div>
        </div>
      )}

      {/* Video source config panel (manual override) */}
      {showConfig && (
        <div className="absolute inset-0 z-20 bg-bg-primary/95 flex items-center justify-center">
          <div className="w-80 space-y-3 p-4 border border-border-default bg-surface-primary">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">Video Source (WHEP)</span>
              <button onClick={() => setShowConfig(false)} className="text-text-tertiary hover:text-text-primary cursor-pointer">
                <X size={14} />
              </button>
            </div>
            <Input
              value={configUrl}
              onChange={(e) => setConfigUrl(e.target.value)}
              placeholder="http://localhost:8889/gazebo-cam/whep"
              label="WHEP Endpoint URL"
            />
            <p className="text-[10px] text-text-tertiary leading-relaxed">
              Leave empty to use the paired agent&apos;s camera automatically.
            </p>
            <div className="flex flex-wrap gap-1">
              {WHEP_PRESETS.map((p) => (
                <button
                  key={p.url}
                  onClick={() => setConfigUrl(p.url)}
                  className={cn(
                    "px-2 py-0.5 text-[9px] font-mono border transition-colors cursor-pointer",
                    configUrl === p.url
                      ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                      : "border-border-default text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleSaveConfig}
              className="w-full py-1.5 text-xs font-semibold bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
            >
              {configUrl ? "Connect" : "Use Agent Camera"}
            </button>
          </div>
        </div>
      )}

      {/* Top-left: REC indicator */}
      {isRecording && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-status-error animate-pulse" />
          <span className="text-xs font-mono font-semibold text-status-error tracking-wider">
            REC
          </span>
          {recElapsed && (
            <span className="text-[10px] font-mono text-status-error/80">{recElapsed}</span>
          )}
        </div>
      )}

      {/* Bottom-left: Video controls */}
      {hasVideo && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1">
          {!hideRecordButton && (
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
              <span className={cn("w-2 h-2 rounded-full", isRecording ? "bg-status-error animate-pulse" : "bg-status-error/60")} />
              {isRecording ? "STOP" : "REC"}
            </button>
          )}
          <button
            onClick={handleScreenshot}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-text-secondary bg-bg-primary/80 border border-border-default rounded hover:text-text-primary hover:bg-bg-primary transition-colors cursor-pointer"
            title="Capture screenshot"
          >
            <Camera size={10} />
          </button>
        </div>
      )}

      {/* Top-right: Video stats + config gear */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <Badge variant="neutral" size="sm">
          {resolution}
        </Badge>
        <Badge
          variant={fps > 0 ? "success" : "neutral"}
          size="sm"
        >
          {fps} FPS
        </Badge>
        <Badge
          variant={latencyMs > 200 ? "warning" : latencyMs > 0 ? "success" : "neutral"}
          size="sm"
        >
          {latencyMs}ms
        </Badge>
        <button
          onClick={() => { setConfigUrl(manualUrl); setShowConfig(!showConfig); }}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          title="Video source settings"
        >
          <Settings2 size={14} />
        </button>
      </div>

      {/* OSD overlay and other children */}
      {children}
    </div>
  );
}
