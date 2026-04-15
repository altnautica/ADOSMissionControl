"use client";

// HUD page. Full-screen flight display for HDMI kiosk mode on the SBC.
//
// Phase 2 Wave C: live telemetry, WebRTC/WHEP video background, gamepad
// polling, PIC claim stub.
//
// Query params:
//   ?layer=minimal    render lightweight inline HUD for low-power SBCs
//                     (Pi 4B, Rock 5C Lite under thermal throttle)
//
// Specs:
//   product/specs/08-hdmi-kiosk-mode.md
//   product/specs/09-joystick-input.md

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TopBar } from "@/components/hud/TopBar";
import { BottomBar } from "@/components/hud/BottomBar";
import { CornerAlerts } from "@/components/hud/CornerAlerts";
import { VideoBackground } from "@/components/hud/VideoBackground";
import {
  getActiveGamepadName,
  startGamepadPolling,
  stopGamepadPolling,
} from "@/lib/input/gamepad-poller";
import { useInputStore } from "@/stores/input-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";

export default function HudPage() {
  return (
    <Suspense fallback={<div className="w-full h-full bg-black" />}>
      <HudRouter />
    </Suspense>
  );
}

function HudRouter() {
  const params = useSearchParams();
  const layer = params.get("layer");
  const minimal = layer === "minimal";
  return minimal ? <MinimalHud /> : <FullHud />;
}

// Gamepad indicator. Shows controller identity + PIC claim state. PIC
// state lives on ground-station-store's `pic` slice (Brass Wave C). Until
// that slice lands, show a neutral "PIC pending" label.
function GamepadIndicator() {
  const controller = useInputStore((s) => s.activeController);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (controller !== "gamepad") {
      setName(null);
      return;
    }
    const id = setInterval(() => {
      setName(getActiveGamepadName());
    }, 1000);
    setName(getActiveGamepadName());
    return () => clearInterval(id);
  }, [controller]);

  const label = controller === "gamepad"
    ? (name ? name.slice(0, 28) : "GAMEPAD")
    : "NO INPUT";

  return (
    <div className="absolute top-12 right-4 flex flex-col items-end gap-1 pointer-events-none">
      <div className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 bg-black/50 text-white/80 border border-white/20 rounded">
        {label}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 bg-black/50 text-white/60 border border-white/10 rounded">
        PIC pending
      </div>
    </div>
  );
}

function FullHud() {
  // Start gamepad polling on mount. Safe to call repeatedly (guarded by
  // internal animation-frame singleton in gamepad-poller).
  useEffect(() => {
    startGamepadPolling();
    return () => {
      stopGamepadPolling();
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <VideoBackground />
      <TopBar />
      <CornerAlerts />
      <GamepadIndicator />
      <BottomBar />
    </div>
  );
}

// Minimal HUD. Single component, inline SVG only, no HUD subcomponent
// imports. Targets Pi 4B class SBCs. Video is still required because the
// operator needs to see the camera feed.
function MinimalHud() {
  useEffect(() => {
    startGamepadPolling();
    return () => {
      stopGamepadPolling();
    };
  }, []);

  // Subscribe to telemetry version to trigger re-render on updates.
  useTelemetryStore((s) => s._version);
  const attitude = useTelemetryStore((s) => s.attitude.latest());
  const vfr = useTelemetryStore((s) => s.vfr.latest());
  const radio = useTelemetryStore((s) => s.radio.latest());
  const battery = useTelemetryStore((s) => s.battery.latest());
  const gps = useTelemetryStore((s) => s.gps.latest());
  const fence = useTelemetryStore((s) => s.fenceStatus.latest());
  const mode = useDroneStore((s) => s.flightMode);

  const f = (n: number | undefined | null, d = 0) =>
    n === undefined || n === null || !Number.isFinite(n) ? "--" : n.toFixed(d);

  const pitchOffset = (attitude?.pitch ?? 0) * 4;
  const rollDeg = attitude?.roll ?? 0;

  const alerts: string[] = [];
  if (battery && battery.remaining <= 15) alerts.push("BATT CRIT");
  else if (battery && battery.remaining <= 25) alerts.push("BATT LOW");
  if (fence && fence.breachStatus > 0) alerts.push("FENCE");

  return (
    <div className="relative w-full h-full bg-black text-white font-mono">
      <VideoBackground />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <svg viewBox="0 0 200 200" width={220} height={220} aria-label="Minimal horizon">
          <g transform={`rotate(${-rollDeg} 100 100)`}>
            <g transform={`translate(0 ${pitchOffset})`}>
              <rect x="-100" y="-200" width="400" height="300" fill="#1e3a5f" opacity="0.35" />
              <rect x="-100" y="100" width="400" height="300" fill="#5a3a1e" opacity="0.35" />
              <line x1="-100" y1="100" x2="300" y2="100" stroke="#ffffff" strokeWidth="1.5" />
            </g>
          </g>
          <line x1="70" y1="100" x2="90" y2="100" stroke="#dff140" strokeWidth="3" />
          <line x1="110" y1="100" x2="130" y2="100" stroke="#dff140" strokeWidth="3" />
          <circle cx="100" cy="100" r="2" fill="#dff140" />
        </svg>
      </div>

      <div className="absolute top-0 left-0 right-0 h-8 px-3 flex items-center justify-between bg-black/60 text-[11px] uppercase tracking-wide pointer-events-none">
        <span>MODE {mode}</span>
        <span>RSSI {radio ? f(radio.rssi, 0) : "--"}</span>
        <span>SATS {gps ? f(gps.satellites, 0) : "--"}</span>
        <span>BAT {battery ? f(battery.remaining, 0) : "--"}%</span>
      </div>

      {alerts.length > 0 && (
        <div className="absolute top-10 left-2 flex flex-col gap-1 pointer-events-none">
          {alerts.map((a) => (
            <div key={a} className="text-[10px] px-1.5 py-0.5 bg-red-900/80 border border-red-400">
              {a}
            </div>
          ))}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 h-10 px-3 flex items-center justify-between bg-black/60 text-sm pointer-events-none">
        <span>HDG {vfr ? f(vfr.heading, 0) : "--"}</span>
        <span>ALT {vfr ? f(vfr.alt, 0) : "--"} m</span>
        <span>SPD {vfr ? f(vfr.groundspeed, 1) : "--"} m/s</span>
      </div>
    </div>
  );
}
