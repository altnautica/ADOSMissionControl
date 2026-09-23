/**
 * @module ReplayView
 * @description Full-screen flight replay view. Composes map, telemetry panel,
 * and playback controls. Manages lifecycle: load recording on mount, cleanup on unmount.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { ArrowLeft, Play } from "lucide-react";
import { formatDecimal } from "@/lib/i18n/format";
import {
  loadPlayback, unloadPlayback, replayBlockedReason,
  play as playerPlay, pause as playerPause, resume as playerResume,
  seek as playerSeek, setSpeed as playerSetSpeed,
  getPlaybackState, type PlaybackSpeed,
} from "@/lib/telemetry-player";
import { ReplayPlaybackBar } from "./ReplayPlaybackBar";
import { ReplayTelemetryPanel } from "./ReplayTelemetryPanel";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";
import type { FlightRecord } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const SPEED_LADDER: PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4, 8];

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
  const locale = useLocale();

  // Load recording and start playback on mount. The live-link check runs
  // before anything touches a store; the player owns every store write,
  // including the cleanup on exit.
  useEffect(() => {
    let mounted = true;

    async function init() {
      const blocked = replayBlockedReason();
      if (blocked) {
        setError(blocked);
        setLoading(false);
        return;
      }
      try {
        await loadPlayback(recording.id);
        if (!mounted) return;
        playerPlay();
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load recording");
        setLoading(false);
      }
    }

    void init();

    return () => {
      mounted = false;
      unloadPlayback();
    };
  }, [recording.id]);

  const ready = !loading && error === null;

  // Keyboard shortcuts. Mounted only while a recording is loaded and playing,
  // so no shortcut can drive the player from the loading or error state.
  useEffect(() => {
    if (!ready) return;
    const run = (action: () => void) => {
      try {
        action();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in a form field
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const status = getPlaybackState();

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (status.state === "playing") playerPause();
        else if (status.state === "paused") run(playerResume);
        else run(playerPlay);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        run(() => playerSeek(0));
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        run(() => playerSeek(status.totalDurationMs));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const step = e.shiftKey ? 10_000 : 1000;
        run(() => playerSeek(Math.max(0, status.currentTimeMs - step)));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 10_000 : 1000;
        run(() => playerSeek(Math.min(status.totalDurationMs, status.currentTimeMs + step)));
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const idx = SPEED_LADDER.indexOf(status.playbackSpeed);
        const next = SPEED_LADDER[Math.max(0, idx - 1)];
        playerSetSpeed(next);
        return;
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (status.state === "playing") playerPause();
        else run(playerResume);
        return;
      }
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        const idx = SPEED_LADDER.indexOf(status.playbackSpeed);
        const next = SPEED_LADDER[Math.min(SPEED_LADDER.length - 1, idx + 1)];
        playerSetSpeed(next);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onExit, ready]);

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
          <span>{formatDecimal(recording.durationMs / 1000, 0, locale)}s</span>
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
          <ReplayPlaybackBar events={flightRecord.events} />
        </>
      )}
    </div>
  );
}
