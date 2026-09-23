"use client";

// HUD top bar. Reads live telemetry via useHudTopBarData (memoized
// against telemetry-store _version). Wrapped in React.memo so parent
// re-renders do not cascade through the always-visible HUD chrome.

import { memo } from "react";
import { useDroneStore } from "@/stores/drone-store";
import { useHudTopBarData } from "@/hooks/use-hud-topbar-data";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { deriveHudStatus } from "@/lib/hud-readings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

function TopBarInner() {
  const { radio, vfr, battery, gps } = useHudTopBarData();
  const position = useFreshTelemetry("position");
  const rawMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);

  // Every other reading on this bar is freshness-gated by `useHudTopBarData`;
  // MODE was read straight from drone-store, so the kiosk rendered the store
  // default "STABILIZE" with nothing connected and kept the last mode name on
  // screen after the link died. Gate it on heartbeat age like the canvas HUD.
  // Battery percent goes through the same gate, which reads the FC's -1
  // ("capacity unknown") as no reading instead of "BAT -1%".
  const { mode, batteryPct } = deriveHudStatus(
    { battery, gps, radio, vfr },
    { armState, flightMode: rawMode, lastHeartbeat },
  );

  const rssi = radio ? fmt(radio.rssi, 0) : "--";
  // Height above home. VFR_HUD.alt and GLOBAL_POSITION_INT.alt are MSL, which
  // reads as the site elevation with the aircraft sitting on the ground.
  const altitudeM = position ? fmt(position.relativeAlt, 0) : "--";
  const speedMs = vfr ? fmt(vfr.groundspeed, 1) : "--";
  const gpsSats = gps ? fmt(gps.satellites, 0) : "--";

  return (
    <div className="absolute top-0 left-0 right-0 h-10 px-4 flex items-center justify-between bg-black/40 backdrop-blur-sm text-xs font-mono uppercase tracking-wide text-white/90 pointer-events-none">
      <div className="flex items-center gap-4">
        <span>MODE {mode ?? NO_DATA_GLYPH}</span>
        <span>RSSI {rssi}</span>
        <span>SATS {gpsSats}</span>
      </div>
      <div className="flex items-center gap-4">
        <span>ALT {altitudeM} m</span>
        <span>SPD {speedMs} m/s</span>
        <span>BAT {fmt(batteryPct, 0)}%</span>
      </div>
    </div>
  );
}

export const TopBar = memo(TopBarInner);
