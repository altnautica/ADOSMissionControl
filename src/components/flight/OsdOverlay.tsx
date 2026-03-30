"use client";

import { useRef, useEffect, useCallback } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { useMissionStore } from "@/stores/mission-store";
import { mpsToKph } from "@/lib/telemetry-utils";
import {
  drawPitchLadder,
  drawRollArc,
  drawCrosshair,
  drawSpeedTape,
  drawAltTape,
  drawHeadingCompass,
  drawBatteryHud,
  drawGpsAndMode,
  drawArmedStatus,
  drawSignalBars,
  drawFlightTimer,
} from "@/lib/hud-draw";

// ── Main component ──────────────────────────────────────────────

export function OsdOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Match canvas to parent size
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (
      canvas.width !== Math.floor(rect.width * dpr) ||
      canvas.height !== Math.floor(rect.height * dpr)
    ) {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // Read telemetry state directly (no hooks — avoids re-renders)
    const tState = useTelemetryStore.getState();
    const dState = useDroneStore.getState();
    const mState = useMissionStore.getState();

    const att = tState.attitude.latest();
    const pos = tState.position.latest();
    const bat = tState.battery.latest();
    const gps = tState.gps.latest();
    const vfr = tState.vfr.latest();

    const pitch = att?.pitch ?? 0;
    const roll = att?.roll ?? 0;
    const heading = pos?.heading ?? vfr?.heading ?? 0;
    const alt = pos?.alt ?? vfr?.alt ?? 0;
    const speedMps = vfr?.groundspeed ?? pos?.groundSpeed ?? 0;
    const speedKph = mpsToKph(speedMps);
    const batteryPct = bat?.remaining ?? 0;
    const satellites = gps?.satellites ?? 0;
    const armed = dState.armState === "armed";
    const mode = dState.flightMode;
    const startedAt = mState.activeMission?.startedAt;

    // Draw OSD elements
    drawPitchLadder(ctx, cx, cy, pitch, roll, h);
    drawRollArc(ctx, cx, cy, roll, h);
    drawCrosshair(ctx, cx, cy);
    drawSpeedTape(ctx, cx - w * 0.25, cy, speedKph, h);
    drawAltTape(ctx, cx + w * 0.25, cy, alt, h);
    drawHeadingCompass(ctx, cx, 30, heading, w);
    drawBatteryHud(ctx, cx, h - 45, batteryPct);
    drawGpsAndMode(ctx, 16, h - 20, satellites, mode);
    drawArmedStatus(ctx, cx, cy + 34, armed);
    drawSignalBars(ctx, w - 80, h - 20, 4);
    drawFlightTimer(ctx, w - 16, h - 20, startedAt);

    rafRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 5 }}
    />
  );
}
