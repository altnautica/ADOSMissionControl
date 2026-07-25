"use client";

import { useState, useEffect, useRef } from "react";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useTelemetryFreshness } from "@/hooks/use-telemetry-freshness";
import { useDroneStore } from "@/stores/drone-store";
import { mpsToKph, normalizeHeading } from "@/lib/telemetry-utils";
import { MODE_DESCRIPTIONS } from "@/components/fc/flight-modes/flight-mode-constants";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { UnifiedFlightMode } from "@/lib/protocol/types";
import { useTelemetryDeck } from "./telemetry-deck/TelemetryDeck";

function gpsFixColor(fixType: number): string {
  if (fixType >= 3) return "text-status-success";
  if (fixType === 2) return "text-status-warning";
  return "text-status-error";
}

function batteryBarColor(pct: number): string {
  if (pct <= 25) return "bg-status-error";
  if (pct <= 50) return "bg-status-warning";
  return "bg-status-success";
}

function FlightCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center py-1.5">
      <span className="text-sm font-mono font-semibold tabular-nums text-text-primary">
        {value}
      </span>
      <span className="text-[10px] text-text-tertiary mt-0.5">{label}</span>
    </div>
  );
}

export function TelemetryReadout() {
  const pos = useTelemetryLatest("position");
  const vfr = useTelemetryLatest("vfr");
  const bat = useTelemetryLatest("battery");
  const gps = useTelemetryLatest("gps");
  const mode = useDroneStore((s) => s.flightMode);
  const { controls: deckControls, panel: deckPanel } = useTelemetryDeck();
  const freshness = useTelemetryFreshness();

  // The ring buffers keep their last sample when the link dies. Gate the
  // flight + battery readouts on channel freshness so a dead link blanks to
  // placeholders instead of freezing 0.0m / 000deg / 0% as if live. ALT / SPD
  // / HDG / VS are sourced from either POSITION or VFR_HUD, so they stay live
  // while either channel is fresh.
  const isChannelLive = (level: string) =>
    level === "fresh" || level === "stale";
  const flightLive =
    isChannelLive(freshness.getFreshness("position")) ||
    isChannelLive(freshness.getFreshness("vfr"));
  const batLive = isChannelLive(freshness.getFreshness("battery"));
  const gpsLive = isChannelLive(freshness.getFreshness("gps"));
  // Buffered flight data exists but has gone stale — the link is silent.
  const flightStale = (pos !== undefined || vfr !== undefined) && !flightLive;

  const alt = pos?.alt ?? vfr?.alt ?? 0;
  const speedKph = mpsToKph(vfr?.groundspeed ?? pos?.groundSpeed ?? 0);
  const heading = normalizeHeading(pos?.heading ?? vfr?.heading ?? 0);
  const vs = vfr?.climb ?? pos?.climbRate ?? 0;
  const batteryPct = bat?.remaining ?? 0;
  const batteryLabel = batLive ? `${Math.round(batteryPct)}%` : "--%";
  // Left absent rather than defaulted so the readout cannot render "0 SAT" for
  // a receiver that has reported nothing. The freshness gate below already
  // blanks a silent link; keeping the value optional means a future change to
  // that gate cannot quietly reintroduce a fabricated zero.
  const satellites = gps?.satellites;
  const fixType = gps?.fixType;
  const gpsKnown = gpsLive && satellites != null && fixType != null;

  return (
    <div className="bg-bg-secondary border-y border-border-default">
      {/* Primary flight metrics — 4 columns */}
      <div className="grid grid-cols-4 divide-x divide-border-default">
        <FlightCell label="ALT" value={flightLive ? `${alt.toFixed(1)}m` : "--.-m"} />
        <FlightCell label="SPD" value={flightLive ? `${speedKph.toFixed(1)}` : "--.-"} />
        <FlightCell
          label="HDG"
          value={
            flightLive
              ? `${String(Math.round(heading)).padStart(3, "0")}\u00B0`
              : "---\u00B0"
          }
        />
        <FlightCell label="VS" value={flightLive ? `${vs.toFixed(1)}` : "--.-"} />
      </div>

      {/* Status bar — GPS, battery, mode, deck controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border-default text-[10px] font-mono">
        {/* GPS — gated on freshness so a silent link blanks the frozen
            sat count + fix dot instead of rendering them as live. */}
        <div className="flex items-center gap-1">
          <span className={cn("inline-block w-1.5 h-1.5 rounded-full", !gpsKnown ? "bg-text-tertiary" : fixType >= 3 ? "bg-status-success" : fixType === 2 ? "bg-status-warning" : "bg-status-error")} />
          <span className={cn("tabular-nums", gpsKnown ? gpsFixColor(fixType) : "text-text-tertiary")}>{gpsKnown ? satellites : "--"}</span>
          <span className="text-text-tertiary">SAT</span>
        </div>

        {/* Battery bar inline */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                batLive ? batteryBarColor(batteryPct) : "bg-bg-tertiary",
              )}
              style={{ width: batLive ? `${Math.max(batteryPct, 2)}%` : "0%" }}
            />
          </div>
          <span
            className={cn(
              "tabular-nums",
              !batLive
                ? "text-text-tertiary"
                : batteryPct <= 25
                  ? "text-status-error"
                  : batteryPct <= 50
                    ? "text-status-warning"
                    : "text-text-secondary",
            )}
          >
            {batteryLabel}
          </span>
        </div>

        {/* Flight mode + deck controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {flightStale && (
            <span className="text-status-warning font-medium uppercase">
              link silent
            </span>
          )}
          <ModeLabel mode={mode} />
          {deckControls}
        </div>
      </div>

      {/* Expandable telemetry deck — full width below status bar */}
      {deckPanel}
    </div>
  );
}

function ModeLabel({ mode }: { mode: string }) {
  const [show, setShow] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const prevModeRef = useRef(mode);
  const { toast } = useToast();
  const desc = MODE_DESCRIPTIONS[mode as UnifiedFlightMode];

  useEffect(() => {
    if (prevModeRef.current !== mode && prevModeRef.current !== "") {
      setHighlight(true);
      toast(`Mode changed: ${prevModeRef.current} -> ${mode}`, "info");
      const timer = setTimeout(() => setHighlight(false), 1500);
      prevModeRef.current = mode;
      return () => clearTimeout(timer);
    }
    prevModeRef.current = mode;
  }, [mode, toast]);

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        className={cn(
          "font-semibold uppercase cursor-default transition-colors duration-300",
          highlight ? "text-status-success" : "text-text-secondary",
        )}
        style={highlight ? {
          animation: "mode-pulse 1.5s ease-out",
          textShadow: "0 0 8px rgba(34, 197, 94, 0.6)",
        } : undefined}
      >
        {mode}
      </span>
      {show && desc && (
        <div className="absolute right-0 bottom-full mb-1 z-50 bg-bg-tertiary border border-border-default px-2 py-1.5 text-[10px] text-text-secondary whitespace-nowrap">
          {desc}
        </div>
      )}
    </div>
  );
}
