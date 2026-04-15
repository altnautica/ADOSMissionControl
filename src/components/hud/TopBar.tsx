"use client";

// HUD top bar. Reads live telemetry from telemetry-store + drone-store
// via RingBuffer.latest() selectors. Bumps on the store's _version field.

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";

function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

export function TopBar() {
  // Subscribe to _version so selectors re-run when ring buffers get new data.
  useTelemetryStore((s) => s._version);

  const radio = useTelemetryStore((s) => s.radio.latest());
  const vfr = useTelemetryStore((s) => s.vfr.latest());
  const battery = useTelemetryStore((s) => s.battery.latest());
  const gps = useTelemetryStore((s) => s.gps.latest());
  const mode = useDroneStore((s) => s.flightMode);

  const rssi = radio ? fmt(radio.rssi, 0) : "--";
  const batteryPct = battery ? fmt(battery.remaining, 0) : "--";
  const altitudeM = vfr ? fmt(vfr.alt, 0) : "--";
  const speedMs = vfr ? fmt(vfr.groundspeed, 1) : "--";
  const gpsSats = gps ? fmt(gps.satellites, 0) : "--";

  return (
    <div className="absolute top-0 left-0 right-0 h-10 px-4 flex items-center justify-between bg-black/40 backdrop-blur-sm text-xs font-mono uppercase tracking-wide text-white/90 pointer-events-none">
      <div className="flex items-center gap-4">
        <span>MODE {mode}</span>
        <span>RSSI {rssi}</span>
        <span>SATS {gpsSats}</span>
      </div>
      <div className="flex items-center gap-4">
        <span>ALT {altitudeM} m</span>
        <span>SPD {speedMs} m/s</span>
        <span>BAT {batteryPct}%</span>
      </div>
    </div>
  );
}
