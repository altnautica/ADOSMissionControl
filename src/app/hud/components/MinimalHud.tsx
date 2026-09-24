"use client";

// Minimal HUD for Pi 4B class SBCs (`/hud?layer=minimal`): one small horizon
// and two text lines over the video. Every reading comes from the same
// freshness-gated derivation the full HUD uses (`readHudFrame`), and the
// alerts are the full HUD's CornerAlerts, so a light layout never means a less
// honest one: no attitude draws the failure flag, a silent link blanks the
// numbers, and an unknown battery percentage reads "--", not a critical alarm.

import { useEffect } from "react";
import { CornerAlerts } from "@/components/hud/CornerAlerts";
import { HorizonSvg } from "@/components/hud/HorizonSvg";
import { VideoBackground } from "@/components/hud/VideoBackground";
import {
  startGamepadPolling,
  stopGamepadPolling,
  startManualControlStream,
} from "@/lib/input/gamepad-poller";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useClockTick } from "@/lib/agent/freshness";
import { readHudFrame } from "@/lib/hud-readings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

export function MinimalHud() {
  useEffect(() => {
    startGamepadPolling();
    startManualControlStream();
    return () => {
      stopGamepadPolling();
    };
  }, []);

  // New telemetry, a heartbeat and passing time all re-render. On link loss
  // only the clock tick moves, and it is what lets the readings blank.
  useTelemetryStore((s) => s._version);
  useDroneStore((s) => s.lastHeartbeat);
  useClockTick();
  const locale = useSettingsStore((s) => s.locale);
  const hud = readHudFrame();

  const f = (n: number | null, d = 0) => {
    if (n === null || !Number.isFinite(n)) return "--";
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    }).format(n);
  };

  return (
    <div className="relative w-full h-full bg-media text-on-media font-mono">
      <VideoBackground />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-80">
        <HorizonSvg pitchDeg={hud.pitch} rollDeg={hud.roll} size={220} />
      </div>

      <div className="absolute top-0 left-0 right-0 h-8 px-3 flex items-center justify-between bg-scrim/60 text-[11px] uppercase tracking-wide pointer-events-none">
        <span>MODE {hud.mode ?? NO_DATA_GLYPH}</span>
        <span>SATS {f(hud.satellites)}</span>
        <span>BAT {f(hud.batteryPct)}%</span>
      </div>

      <CornerAlerts />

      <div className="absolute bottom-0 left-0 right-0 h-10 px-3 flex items-center justify-between bg-scrim/60 text-sm pointer-events-none">
        <span>HDG {f(hud.heading)}</span>
        <span>ALT {f(hud.alt)} m</span>
        <span>SPD {f(hud.speedMps, 1)} m/s</span>
      </div>
    </div>
  );
}
