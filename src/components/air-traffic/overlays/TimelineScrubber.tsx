/**
 * @module TimelineScrubber
 * @description Horizontal time bar at bottom of viewport for viewing
 * time-dependent restrictions (TFRs, NOTAMs). "Now" button snaps to current time.
 * Also shows viewport stats (aircraft count, airports, camera altitude, connection).
 * @license GPL-3.0-only
 */

"use client";

import { useCallback } from "react";
import { Clock, RotateCcw, Plane, MapPin, Radio } from "lucide-react";
import { useAirspaceStore } from "@/stores/airspace-store";
import { useTrafficStore } from "@/stores/traffic-store";
import { cn } from "@/lib/utils";

function formatAltitude(m: number): string {
  if (m > 1_000_000) return `${(m / 1_000_000).toFixed(1)}Mm`;
  if (m > 1_000) return `${(m / 1_000).toFixed(0)}km`;
  return `${m.toFixed(0)}m`;
}

export function TimelineScrubber() {
  const timelineTime = useAirspaceStore((s) => s.timelineTime);
  const setTimelineTime = useAirspaceStore((s) => s.setTimelineTime);
  const viewportState = useAirspaceStore((s) => s.viewportState);

  const aircraft = useTrafficStore((s) => s.aircraft);
  const connectionQuality = useTrafficStore((s) => s.connectionQuality);
  const lastUpdate = useTrafficStore((s) => s.lastUpdate);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const currentMinutes = Math.round(
    (timelineTime.getTime() - startOfDay.getTime()) / (60 * 1000)
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const minutes = parseInt(e.target.value, 10);
      const newTime = new Date(startOfDay.getTime() + minutes * 60 * 1000);
      setTimelineTime(newTime);
    },
    [startOfDay, setTimelineTime]
  );

  const snapToNow = useCallback(() => {
    setTimelineTime(new Date());
  }, [setTimelineTime]);

  // Round to 5-minute step granularity for "Now" detection
  const isNow = Math.abs(timelineTime.getTime() - now.getTime()) < 5 * 60 * 1000;

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  const freshness = lastUpdate ? `${Math.round((Date.now() - lastUpdate) / 1000)}s` : "-";

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg">
      <Clock size={12} className="text-text-tertiary shrink-0" />

      <span className="text-[10px] font-mono text-text-tertiary w-10">00:00</span>

      <input
        type="range"
        min={0}
        max={1440}
        step={5}
        value={currentMinutes}
        onChange={handleChange}
        className="w-48 h-1 rounded-full appearance-none bg-border-default accent-accent-primary cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-primary"
      />

      <span className="text-[10px] font-mono text-text-tertiary w-10 text-right">23:59</span>

      <div className="flex items-center gap-2 pl-2 border-l border-border-default">
        <span className="text-[11px] font-mono text-text-primary font-bold w-12">
          {formatTime(timelineTime)}
        </span>

        <button
          onClick={snapToNow}
          className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded transition-colors cursor-pointer ${
            isNow
              ? "bg-accent-primary/20 text-accent-primary"
              : "bg-bg-secondary text-text-secondary hover:text-text-primary"
          }`}
        >
          <RotateCcw size={10} className="inline mr-1" />
          NOW
        </button>
      </div>

      {/* Viewport stats */}
      <div className="flex items-center gap-2 pl-2 border-l border-border-default text-[9px] font-mono text-text-secondary">
        <div className="flex items-center gap-1" title={`${viewportState.aircraftInView} in viewport / ${aircraft.size} total`}>
          <Plane size={9} className="text-text-tertiary" />
          <span className="text-text-primary font-bold">{viewportState.aircraftInView}</span>
          <span className="text-text-tertiary">/</span>
          <span>{aircraft.size}</span>
        </div>

        <div className="w-px h-3 bg-border-default/50" />

        <div className="flex items-center gap-1" title="Airports in viewport">
          <MapPin size={9} className="text-text-tertiary" />
          <span>{viewportState.visibleAirports.length}</span>
        </div>

        <div className="w-px h-3 bg-border-default/50" />

        <span title="Camera altitude" className="text-text-tertiary">
          {formatAltitude(viewportState.cameraAlt)}
        </span>

        <div className="w-px h-3 bg-border-default/50" />

        <div className="flex items-center gap-1" title={`Connection: ${connectionQuality}`}>
          <Radio size={9} className="text-text-tertiary" />
          <span className={cn(
            "w-1.5 h-1.5 rounded-full",
            connectionQuality === "good" && "bg-green-400",
            connectionQuality === "degraded" && "bg-yellow-400",
            connectionQuality === "disconnected" && "bg-red-400",
          )} />
          <span className="text-text-tertiary">{freshness}</span>
        </div>
      </div>
    </div>
  );
}
