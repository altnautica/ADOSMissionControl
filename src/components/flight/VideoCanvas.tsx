"use client";

import { useState, useEffect, useCallback } from "react";
import { useVideoStore } from "@/stores/video-store";
import { startRecording as startVideoRecording, stopRecording as stopVideoRecording, captureScreenshot } from "@/lib/video/webrtc-client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Camera } from "lucide-react";
import type { ReactNode } from "react";

interface VideoCanvasProps {
  children?: ReactNode;
  className?: string;
}

export function VideoCanvas({ children, className }: VideoCanvasProps) {
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const isRecording = useVideoStore((s) => s.isRecording);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);

  // Video recording timer
  const [recStartMs, setRecStartMs] = useState(0);
  const [recElapsed, setRecElapsed] = useState("");

  useEffect(() => {
    if (!isRecording) { setRecElapsed(""); return; }
    setRecStartMs(Date.now());
    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - recStartMs) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setRecElapsed(`${m}:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording, recStartMs]);

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

  return (
    <div
      className={cn(
        "relative w-full h-full bg-bg-primary overflow-hidden",
        className
      )}
    >
      {/* 16:9 video area */}
      <div className="absolute inset-0 flex items-center justify-center">
        {!isStreaming && (
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
              NO SIGNAL
            </span>
          </div>
        )}
      </div>

      {/* Top-left: REC indicator + elapsed time */}
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

      {/* Bottom-left: Video controls (record + screenshot) */}
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

      {/* Top-right: Video stats */}
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
      </div>

      {/* OSD overlay and other children */}
      {children}
    </div>
  );
}
