"use client";

import { useState, useEffect, useRef } from "react";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useLiveFlightMode } from "@/hooks/use-live-flight-mode";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { mpsToKph, normalizeHeading } from "@/lib/telemetry-utils";
import { knownRemainingPct } from "@/lib/battery";
import { MODE_DESCRIPTIONS } from "@/components/fc/flight-modes/flight-mode-constants";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { FlightMode } from "@/lib/types";
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
  // Each channel is its fresh sample or undefined. The ring buffers keep their
  // last sample when the link dies, so each readout takes its value only from
  // a source that is itself fresh: a stale position must never win over a
  // live VFR_HUD just because it comes first in a fallback chain.
  const pos = useFreshTelemetry("position");
  const vfr = useFreshTelemetry("vfr");
  const bat = useFreshTelemetry("battery");
  const gps = useFreshTelemetry("gps");
  // Null until a live heartbeat backs it: the store holds a placeholder after
  // a drone switch and the last mode after the link goes quiet.
  const mode = useLiveFlightMode();
  const { controls: deckControls, panel: deckPanel } = useTelemetryDeck();

  // Height above home (relative_alt). GLOBAL_POSITION_INT.alt and VFR_HUD.alt
  // are MSL, which reads as the site elevation with the aircraft on the ground.
  const alt = pos?.relativeAlt;
  const speedMps = vfr?.groundspeed ?? pos?.groundSpeed;
  const headingDeg = pos?.heading ?? vfr?.heading;
  const vs = vfr?.climb ?? pos?.climbRate;
  const batteryPct = knownRemainingPct(bat?.remaining);
  const batteryLabel = batteryPct !== null ? `${Math.round(batteryPct)}%` : "--%";
  // Buffered flight data exists but none of it is fresh: the link is silent.
  const buffers = useTelemetryStore.getState();
  const flightStale =
    pos === undefined &&
    vfr === undefined &&
    (buffers.position.latest() !== undefined || buffers.vfr.latest() !== undefined);
  // Left absent rather than defaulted so the readout cannot render "0 SAT" for
  // a receiver that has reported nothing.
  const satellites = gps?.satellites;
  const fixType = gps?.fixType;
  const gpsKnown = satellites != null && fixType != null;

  return (
    <div className="bg-bg-secondary border-y border-border-default">
      {/* Primary flight metrics — 4 columns */}
      <div className="grid grid-cols-4 divide-x divide-border-default">
        <FlightCell label="ALT" value={alt !== undefined ? `${alt.toFixed(1)}m` : "--.-m"} />
        <FlightCell
          label="SPD"
          value={speedMps !== undefined ? `${mpsToKph(speedMps).toFixed(1)}` : "--.-"}
        />
        <FlightCell
          label="HDG"
          value={
            headingDeg !== undefined
              ? `${String(Math.round(normalizeHeading(headingDeg))).padStart(3, "0")}\u00B0`
              : "---\u00B0"
          }
        />
        <FlightCell label="VS" value={vs !== undefined ? `${vs.toFixed(1)}` : "--.-"} />
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
                batteryPct !== null ? batteryBarColor(batteryPct) : "bg-bg-tertiary",
              )}
              style={{ width: batteryPct !== null ? `${Math.max(batteryPct, 2)}%` : "0%" }}
            />
          </div>
          <span
            className={cn(
              "tabular-nums",
              batteryPct === null
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

function ModeLabel({ mode }: { mode: FlightMode | null }) {
  const [show, setShow] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const prevModeRef = useRef(mode);
  const { toast } = useToast();
  const desc = mode === null ? undefined : MODE_DESCRIPTIONS[mode as UnifiedFlightMode];

  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    // Only a change between two heartbeat-backed modes is a transition. A
    // switch from "no live mode" (link just came up, drone just selected) is
    // the first reading, not something the aircraft did.
    if (prev === null || mode === null || prev === mode) return;
    setHighlight(true);
    toast(`Mode changed: ${prev} -> ${mode}`, "info");
    const timer = setTimeout(() => setHighlight(false), 1500);
    return () => clearTimeout(timer);
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
        {mode ?? "--"}
      </span>
      {show && desc && (
        <div className="absolute right-0 bottom-full mb-1 z-50 bg-bg-tertiary border border-border-default px-2 py-1.5 text-[10px] text-text-secondary whitespace-nowrap">
          {desc}
        </div>
      )}
    </div>
  );
}
