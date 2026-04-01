"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useVideoStore } from "@/stores/video-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import {
  startStream,
  stopStream,
  setVideoElement,
  isStreamActive,
  startRecording as startVideoRecording,
  stopRecording as stopVideoRecording,
  captureScreenshot,
} from "@/lib/video/webrtc-client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Camera, Settings2, X } from "lucide-react";
import type { ReactNode } from "react";

interface VideoCanvasProps {
  children?: ReactNode;
  className?: string;
}

const WHEP_PRESETS = [
  { label: "Gazebo SITL", url: "http://localhost:8889/gazebo-cam/whep" },
  { label: "Agent (local)", url: "http://192.168.1.50:8889/stream/whep" },
];

export function VideoCanvas({ children, className }: VideoCanvasProps) {
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const isRecording = useVideoStore((s) => s.isRecording);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);

  // Per-drone video URL from drone metadata
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const droneProfile = useDroneMetadataStore((s) =>
    selectedDroneId ? s.profiles[selectedDroneId] : undefined
  );
  const upsertProfile = useDroneMetadataStore((s) => s.upsertProfile);
  const videoWhepUrl = droneProfile?.videoWhepUrl ?? "";
  const setVideoWhepUrl = (url: string) => {
    if (selectedDroneId) {
      upsertProfile(selectedDroneId, { videoWhepUrl: url });
    }
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configUrl, setConfigUrl] = useState(videoWhepUrl);

  // Recording timer
  const [recElapsed, setRecElapsed] = useState("");

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

  // Auto-connect when component mounts and WHEP URL is set
  useEffect(() => {
    if (!videoWhepUrl || isStreaming) return;

    let cancelled = false;

    async function connect() {
      setConnecting(true);
      setError(null);
      try {
        const stream = await startStream(videoWhepUrl);
        if (cancelled) {
          stopStream();
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setVideoElement(videoRef.current);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Video connection failed");
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (isStreamActive()) {
        stopStream();
      }
    };
  }, [videoWhepUrl, selectedDroneId]);

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

  return (
    <div
      className={cn(
        "relative w-full h-full bg-bg-primary overflow-hidden",
        className
      )}
    >
      {/* Video element (always rendered, hidden when not streaming) */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn(
          "absolute inset-0 w-full h-full object-contain",
          !isStreaming && "hidden"
        )}
      />

      {/* NO SIGNAL placeholder */}
      {!isStreaming && (
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
              {connecting ? "CONNECTING..." : error ? "CONNECTION FAILED" : videoWhepUrl ? "NO SIGNAL" : "NO VIDEO SOURCE"}
            </span>
            {error && (
              <span className="text-[10px] text-status-error max-w-[200px] text-center">
                {error}
              </span>
            )}
            {!videoWhepUrl && !showConfig && (
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

      {/* Video source config panel */}
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
              Connect
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
      {isStreaming && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1">
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
          onClick={() => { setConfigUrl(videoWhepUrl); setShowConfig(!showConfig); }}
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
