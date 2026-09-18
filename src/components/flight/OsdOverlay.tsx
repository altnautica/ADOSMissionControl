"use client";

import { useRef, useEffect } from "react";
import { useMissionStore } from "@/stores/mission-store";
import { readHudFrame } from "@/lib/hud-readings";
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
  /**
   * Parent size, measured by a `ResizeObserver` rather than read inside
   * the draw loop.
   *
   * `getBoundingClientRect()` forces a synchronous layout flush, and this
   * loop runs at 60 Hz on the piloting surface — so the OSD was making the
   * browser re-lay-out the page once per frame, for a value that only
   * changes when the pane resizes.
   */
  const sizeRef = useRef({ width: 0, height: 0 });

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = sizeRef.current;
    if (rect.width <= 0 || rect.height <= 0) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
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

    // One freshness-gated read, shared with the Overview HUD: an absent sample
    // draws an explicit unknown instead of a level horizon or a full-strength
    // signal meter (Rule 44).
    const hud = readHudFrame();
    const startedAt = useMissionStore.getState().activeMission?.startedAt;

    // Draw OSD elements
    drawPitchLadder(ctx, cx, cy, hud.pitch, hud.roll, h);
    drawRollArc(ctx, cx, cy, hud.roll, h);
    drawCrosshair(ctx, cx, cy);
    drawSpeedTape(ctx, cx - w * 0.25, cy, hud.speedKph, h);
    drawAltTape(ctx, cx + w * 0.25, cy, hud.alt, h);
    drawHeadingCompass(ctx, cx, 30, hud.heading, w);
    drawBatteryHud(ctx, cx, h - 45, hud.batteryPct);
    drawGpsAndMode(ctx, 16, h - 20, hud.satellites, hud.mode);
    drawArmedStatus(ctx, cx, cy + 34, hud.armed);
    drawSignalBars(ctx, w - 80, h - 20, hud.signalBars);
    drawFlightTimer(ctx, w - 16, h - 20, startedAt);

    rafRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const rect = parent.getBoundingClientRect();
      sizeRef.current = { width: rect.width, height: rect.height };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
    // `draw` is redefined every render but the loop is started once and
    // reads everything through refs and store getters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 5 }}
    />
  );
}
