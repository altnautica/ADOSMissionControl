/**
 * @module ReplayPlaybackBar
 * @description Transport controls for flight replay: play/pause, step, scrubber, speed, time display.
 * Subscribes to telemetry-player state. No props needed.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  play, pause, resume, seek, setSpeed,
  getPlaybackState, onPlaybackChange,
  type PlaybackStatus, type PlaybackSpeed,
} from "@/lib/telemetry-player";
import {
  Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Select } from "@/components/ui/select";
import type { FlightEvent } from "@/lib/types";

const SPEED_OPTIONS = [
  { value: "0.25", label: "0.25x" },
  { value: "0.5", label: "0.5x" },
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "4", label: "4x" },
  { value: "8", label: "8x" },
];

const STEP_MS = 5000; // 5 second step

const eventColor: Record<FlightEvent["severity"], string> = {
  info: "#3a82ff",
  warning: "#f59e0b",
  error: "#ef4444",
};

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

interface ReplayPlaybackBarProps {
  events?: FlightEvent[];
}

export function ReplayPlaybackBar({ events = [] }: ReplayPlaybackBarProps = {}) {
  const [status, setStatus] = useState<PlaybackStatus>(getPlaybackState());
  const scrubRef = useRef(false);
  void scrubRef;

  useEffect(() => {
    const unsub = onPlaybackChange(setStatus);
    return unsub;
  }, []);

  // Update display at 4Hz for smooth scrubber
  useEffect(() => {
    if (status.state !== "playing") return;
    const timer = setInterval(() => {
      setStatus(getPlaybackState());
    }, 250);
    return () => clearInterval(timer);
  }, [status.state]);

  const handlePlayPause = useCallback(() => {
    if (status.state === "playing") {
      pause();
    } else if (status.state === "paused") {
      resume();
    } else {
      play();
    }
  }, [status.state]);

  const handleSkipStart = useCallback(() => seek(0), []);
  const handleSkipEnd = useCallback(() => seek(status.totalDurationMs), [status.totalDurationMs]);
  const handleStepBack = useCallback(() => seek(Math.max(0, status.currentTimeMs - STEP_MS)), [status.currentTimeMs]);
  const handleStepForward = useCallback(() => seek(Math.min(status.totalDurationMs, status.currentTimeMs + STEP_MS)), [status.currentTimeMs, status.totalDurationMs]);

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number(e.target.value) / 1000;
    seek(pct * status.totalDurationMs);
  }, [status.totalDurationMs]);

  const handleSpeedChange = useCallback((value: string) => {
    setSpeed(Number(value) as PlaybackSpeed);
  }, []);

  const progress = status.totalDurationMs > 0
    ? (status.currentTimeMs / status.totalDurationMs) * 1000
    : 0;

  const isPlaying = status.state === "playing";

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-bg-primary/90 backdrop-blur-sm border-t border-border-default">
      {/* Transport buttons */}
      <div className="flex items-center gap-1">
        <button onClick={handleSkipStart} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer" title="Skip to start">
          <SkipBack size={14} />
        </button>
        <button onClick={handleStepBack} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer" title="Step back 5s">
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={handlePlayPause}
          className="p-1.5 text-accent-primary hover:text-accent-primary/80 cursor-pointer"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={handleStepForward} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer" title="Step forward 5s">
          <ChevronRight size={14} />
        </button>
        <button onClick={handleSkipEnd} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer" title="Skip to end">
          <SkipForward size={14} />
        </button>
      </div>

      {/* Timeline scrubber */}
      <div className="flex-1 relative">
        {/* Event ticks (above the range track) */}
        {status.totalDurationMs > 0 && events.length > 0 && (
          <div className="absolute -top-2 left-0 right-0 h-2 pointer-events-none">
            {events.map((e, i) => {
              const pct = (e.t / status.totalDurationMs) * 100;
              if (pct < 0 || pct > 100) return null;
              return (
                <button
                  key={`${e.type}-${i}`}
                  type="button"
                  className="absolute top-0 w-[3px] h-2 -translate-x-1/2 cursor-pointer pointer-events-auto rounded-sm"
                  style={{ left: `${pct}%`, backgroundColor: eventColor[e.severity] }}
                  title={`${e.label} @ ${formatTime(e.t)}`}
                  onClick={() => seek(e.t)}
                />
              );
            })}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress)}
          onChange={handleScrub}
          className="w-full h-1.5 accent-accent-primary cursor-pointer"
        />
      </div>

      {/* Time display */}
      <span className="text-[11px] font-mono text-text-secondary shrink-0 w-24 text-center">
        {formatTime(status.currentTimeMs)} / {formatTime(status.totalDurationMs)}
      </span>

      {/* Speed selector */}
      <Select
        value={String(status.playbackSpeed)}
        onChange={handleSpeedChange}
        options={SPEED_OPTIONS}
      />
    </div>
  );
}
