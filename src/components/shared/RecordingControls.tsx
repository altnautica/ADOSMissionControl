/**
 * @module RecordingControls
 * @description Header-bar telemetry recording controls.
 * Start/stop recording, shows duration and frame count while active.
 * When telemetry-player is playing back, shows a REPLAY badge with
 * progress bar and speed indicator.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { CircleDot, Square, Download, Play, Pause, FileDown } from "lucide-react";
import {
  startRecording,
  stopRecording,
  getRecordingState,
  exportRecordingCSV,
  exportTlog,
} from "@/lib/telemetry-recorder";
import {
  getPlaybackState,
  onPlaybackChange,
  type PlaybackStatus,
} from "@/lib/telemetry-player";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function RecordingControls({ className }: { className?: string }) {
  const t = useTranslations("recording");
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [lastRecordingId, setLastRecordingId] = useState<string | null>(null);

  // Playback state tracking
  const [playback, setPlayback] = useState<PlaybackStatus | null>(null);

  // Subscribe to playback state changes
  useEffect(() => {
    // Set initial state
    const initial = getPlaybackState();
    if (initial.state !== "stopped" || initial.recordingId) {
      setPlayback(initial);
    }

    const unsub = onPlaybackChange((status) => {
      setPlayback(status.state === "stopped" && !status.recordingId ? null : status);
    });
    return unsub;
  }, []);

  // Poll recording state while active
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      const state = getRecordingState();
      setDurationMs(state.durationMs);
      setFrameCount(state.frameCount);
    }, 250);
    return () => clearInterval(interval);
  }, [isRecording]);

  const handleStart = useCallback(() => {
    const drone = useDroneManager.getState().getSelectedDrone();
    const id = startRecording(drone?.id, drone?.name);
    setIsRecording(true);
    setLastRecordingId(id);
    toast("Recording started", "success");
  }, [toast]);

  const handleStop = useCallback(async () => {
    const recording = await stopRecording();
    setIsRecording(false);
    setDurationMs(0);
    setFrameCount(0);
    if (recording) {
      setLastRecordingId(recording.id);
      toast(
        `Recording saved: ${recording.frameCount} frames, ${formatDuration(recording.durationMs)}`,
        "success",
      );
    }
  }, [toast]);

  const handleExportCSV = useCallback(async () => {
    if (!lastRecordingId) return;
    const csv = await exportRecordingCSV(lastRecordingId);
    if (!csv) {
      toast("No frames to export");
      return;
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV exported", "success");
  }, [lastRecordingId, toast]);

  const handleExportTlog = useCallback(async () => {
    if (!lastRecordingId) return;
    const blob = await exportTlog(lastRecordingId);
    if (!blob) {
      toast("No frames to export");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telemetry-${new Date().toISOString().slice(0, 10)}.tlog`;
    a.click();
    URL.revokeObjectURL(url);
    toast(".tlog exported", "success");
  }, [lastRecordingId, toast]);

  const isPlaying = playback && (playback.state === "playing" || playback.state === "paused");
  const progressPct = playback && playback.totalDurationMs > 0
    ? Math.min(100, (playback.currentTimeMs / playback.totalDurationMs) * 100)
    : 0;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {/* Replay indicator — shown when telemetry player is active */}
      {isPlaying && playback && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-accent-primary/10 border border-accent-primary/30">
          {playback.state === "playing" ? (
            <Play size={9} className="text-accent-primary" />
          ) : (
            <Pause size={9} className="text-accent-primary" />
          )}
          <span className="text-[10px] font-mono font-semibold text-accent-primary uppercase tracking-wider">
            {t("replay")}
          </span>
          {/* Progress bar */}
          <div className="w-16 h-1 bg-bg-primary/50 overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* Time */}
          <span className="text-[9px] font-mono tabular-nums text-text-tertiary">
            {formatDuration(playback.currentTimeMs)}/{formatDuration(playback.totalDurationMs)}
          </span>
          {/* Speed */}
          <span className="text-[9px] font-mono text-accent-primary/70">
            {playback.playbackSpeed}x
          </span>
        </div>
      )}

      {/* Recording controls */}
      {isRecording ? (
        <>
          {/* Recording indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-status-error/10 border border-status-error/30 text-status-error">
            <CircleDot size={10} className="animate-pulse" />
            <span className="text-[10px] font-mono tabular-nums">
              {formatDuration(durationMs)}
            </span>
            <span className="text-[9px] font-mono text-text-tertiary">
              {frameCount}f
            </span>
          </div>
          <button
            onClick={handleStop}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono border border-status-error/30 text-status-error hover:bg-status-error/10 transition-colors"
            title={t("stopRecording")}
          >
            <Square size={8} />
            {t("stop")}
          </button>
        </>
      ) : (
        <>
          <button
            onClick={handleStart}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono border border-border-default text-text-secondary hover:text-text-primary hover:border-status-error/50 transition-colors"
            title={t("startRecording")}
          >
            <CircleDot size={10} />
            {t("rec")}
          </button>
          {lastRecordingId && (
            <>
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1 px-1.5 py-1 text-[10px] font-mono border border-border-default text-text-tertiary hover:text-text-primary transition-colors"
                title={t("exportCsv")}
              >
                <Download size={10} />
              </button>
              <button
                onClick={handleExportTlog}
                className="flex items-center gap-1 px-1.5 py-1 text-[10px] font-mono border border-border-default text-text-tertiary hover:text-text-primary transition-colors"
                title={t("exportTlog")}
              >
                <FileDown size={10} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
