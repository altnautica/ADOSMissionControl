/**
 * @module PlaybackControls
 * @description Transport bar for simulation playback: play/pause, step, scrubber, speed selector.
 * @license GPL-3.0-only
 */

"use client";

import type { ReactNode } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSimulationStore } from "@/stores/simulation-store";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { useThrottledElapsed } from "@/hooks/use-throttled-elapsed";
import { formatEta } from "@/lib/simulation-utils";
import { PLAYBACK_SPEEDS } from "@/lib/sim-clock";
import type { Waypoint } from "@/lib/types";

const SPEED_OPTIONS = PLAYBACK_SPEEDS.map((s) => ({
  value: String(s),
  label: `${s}x`,
}));

const SECONDARY_BTN =
  "p-1 text-text-secondary hover:text-text-primary disabled:opacity-30 cursor-pointer disabled:cursor-default";

function TransportButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} position="top">
      <button onClick={onClick} disabled={disabled} aria-label={label} className={className}>
        {children}
      </button>
    </Tooltip>
  );
}

interface PlaybackControlsProps {
  waypoints: Waypoint[];
  totalDuration: number;
}

export function PlaybackControls({ waypoints, totalDuration }: PlaybackControlsProps) {
  const t = useTranslations("simulate");
  const playbackState = useSimulationStore((s) => s.playbackState);
  const playbackSpeed = useSimulationStore((s) => s.playbackSpeed);
  const elapsed = useThrottledElapsed();
  const play = useSimulationStore((s) => s.play);
  const pause = useSimulationStore((s) => s.pause);
  const seekToStart = useSimulationStore((s) => s.seekToStart);
  const seek = useSimulationStore((s) => s.seek);
  const stepForward = useSimulationStore((s) => s.stepForward);
  const stepBack = useSimulationStore((s) => s.stepBack);
  const setSpeed = useSimulationStore((s) => s.setSpeed);

  const disabled = waypoints.length < 2;

  return (
    <FloatingPanel
      docked
      padded={false}
      className="flex max-w-full min-w-0 flex-wrap items-center justify-center gap-2 px-4 py-2"
    >
      {/* Skip to start — seeks to the start, does not halt playback */}
      <TransportButton
        label={t("skipToStart")}
        onClick={seekToStart}
        disabled={disabled}
        className={SECONDARY_BTN}
      >
        <SkipBack size={14} />
      </TransportButton>

      <TransportButton
        label={t("stepBackLeft")}
        onClick={stepBack}
        disabled={disabled}
        className={SECONDARY_BTN}
      >
        <ChevronLeft size={14} />
      </TransportButton>

      <TransportButton
        label={t("playPauseSpace")}
        onClick={playbackState === "playing" ? pause : play}
        disabled={disabled}
        className="p-1.5 rounded-full bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-30 cursor-pointer disabled:cursor-default"
      >
        {playbackState === "playing" ? <Pause size={16} /> : <Play size={16} />}
      </TransportButton>

      <TransportButton
        label={t("stepForwardRight")}
        onClick={stepForward}
        disabled={disabled}
        className={SECONDARY_BTN}
      >
        <ChevronRight size={14} />
      </TransportButton>

      <TransportButton
        label={t("skipToEndEnd")}
        onClick={() => seek(totalDuration)}
        disabled={disabled}
        className={SECONDARY_BTN}
      >
        <SkipForward size={14} />
      </TransportButton>

      {/* Time display */}
      <span className="text-[10px] font-mono text-text-secondary w-20 text-center">
        {formatEta(elapsed)} / {formatEta(totalDuration)}
      </span>

      {/* Scrubber */}
      <Tooltip content={t("scrubber")} position="top">
        <input
          type="range"
          min={0}
          max={totalDuration || 1}
          step={Math.max(0.1, totalDuration / 1000)}
          value={elapsed}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={disabled}
          aria-label={t("scrubber")}
          className="w-40 min-w-16 shrink h-1 accent-accent-primary cursor-pointer disabled:cursor-default disabled:opacity-30"
        />
      </Tooltip>

      {/* Speed selector */}
      <Select
        value={String(playbackSpeed)}
        onChange={(v) => setSpeed(Number(v))}
        disabled={disabled}
        options={SPEED_OPTIONS}
        className="text-[10px] font-mono"
      />
    </FloatingPanel>
  );
}
