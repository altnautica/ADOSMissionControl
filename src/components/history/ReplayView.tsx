/**
 * @module ReplayView
 * @description Full-screen flight replay view. Composes map, telemetry panel,
 * and playback controls. Manages lifecycle: load recording on mount, cleanup on unmount.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Play } from "lucide-react";
import {
  loadPlayback, play as playerPlay, stop as playerStop,
  getPlaybackState,
} from "@/lib/telemetry-player";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";
import { ReplayPlaybackBar } from "./ReplayPlaybackBar";
import { ReplayTelemetryPanel } from "./ReplayTelemetryPanel";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";
import type { FlightRecord } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/utils";

const ReplayMap = dynamic(
  () => import("./ReplayMap").then((m) => ({ default: m.ReplayMap })),
  { ssr: false, loading: () => <div className="flex-1 bg-bg-tertiary" /> },
);

interface ReplayViewProps {
  recording: TelemetryRecording;
  flightRecord: FlightRecord;
  onExit: () => void;
}

export function ReplayView({ recording, flightRecord, onExit }: ReplayViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load recording and start playback on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // Clear any stale data
        useTelemetryStore.getState().clear();
        useTrailStore.getState().clear();

        await loadPlayback(recording.id);
        if (!mounted) return;

        setLoading(false);
        playerPlay();
      } catch (err) {
        if (!mounted) return;
        setError("Failed to load recording");
        setLoading(false);
      }
    }

    init();

    // Cleanup on unmount
    return () => {
      mounted = false;
      playerStop();
      useTelemetryStore.getState().clear();
      useTrailStore.getState().clear();
    };
  }, [recording.id]);

  const dateStr = formatDate(flightRecord.date);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-secondary shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} />
            Exit Replay
          </button>
          <div className="w-px h-4 bg-border-default" />
          <div className="flex items-center gap-2">
            <Play size={12} className="text-accent-primary" />
            <span className="text-xs font-mono text-text-primary">
              {flightRecord.droneName}
            </span>
            <span className="text-[10px] text-text-tertiary font-mono">
              {dateStr}
            </span>
          </div>
        </div>

        {/* Recording info */}
        <div className="flex items-center gap-3 text-[10px] font-mono text-text-tertiary">
          <span>{recording.frameCount.toLocaleString()} frames</span>
          <span>{recording.channels.length} channels</span>
          <span>{(recording.durationMs / 1000).toFixed(0)}s</span>
        </div>
      </div>

      {/* Main content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center bg-bg-tertiary">
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-text-tertiary font-mono">Loading recording...</span>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center bg-bg-tertiary">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-status-error font-mono">{error}</span>
            <button
              onClick={onExit}
              className="text-xs text-accent-primary hover:underline cursor-pointer"
            >
              Return to History
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-1 overflow-hidden">
            {/* Map (left, flexible) */}
            <ReplayMap />

            {/* Telemetry panel (right, fixed width) */}
            <ReplayTelemetryPanel />
          </div>

          {/* Playback controls (bottom) */}
          <ReplayPlaybackBar />
        </>
      )}
    </div>
  );
}
