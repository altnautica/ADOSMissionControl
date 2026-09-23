"use client";

/**
 * @module fly/CockpitDemoStream
 * @description Demo-only synthetic video for the cockpit stream switcher. In
 * demo mode there is no live WebRTC, so this paints a distinct, labeled,
 * gently-animated canvas per stream — so switching the `1..N` tabs and the PiP
 * inset visibly change the picture without any hardware. It is strictly
 * `isDemoMode()`-gated and clearly tagged "DEMO FEED"; it never renders for a
 * real node (whose true video comes over WHEP) and never fabricates a live feed
 * on a real surface (no fabricated reading).
 *
 * Reused for both the main view (the active stream) and the PiP inset (a
 * specific stream id).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { isDemoMode } from "@/lib/utils";
import {
  useVideoStreamsStore,
  type StreamRole,
} from "@/stores/video-streams-store";

/** A distinct hue per stream so each feed reads differently. Thermal (ir) runs
 * a warm palette; the EO variants sit in the blue/cyan range. */
function paletteFor(
  role: StreamRole | undefined,
  index: number,
): { a: string; b: string; grid: string } {
  switch (role) {
    case "ir":
      return { a: "#2a1005", b: "#7a2f0a", grid: "rgba(255,150,60,0.16)" };
    case "eo_wide":
      return { a: "#04212a", b: "#0a5a6e", grid: "rgba(80,220,240,0.14)" };
    case "split":
      return { a: "#150a26", b: "#3a1f6e", grid: "rgba(170,130,255,0.15)" };
    case "eo":
      return { a: "#04121e", b: "#0a4a7a", grid: "rgba(99,179,255,0.15)" };
    default: {
      // Vary by index so unlabeled cameras still read distinctly.
      const hues = ["#0a2233", "#0a3325", "#33240a", "#2a0a2a"];
      const b = hues[(index - 1 + hues.length) % hues.length];
      return { a: "#05121e", b, grid: "rgba(160,190,220,0.12)" };
    }
  }
}

interface CockpitDemoStreamProps {
  droneId: string;
  /** Render this specific stream (the PiP inset). Omit for the active stream. */
  streamId?: string;
}

export function CockpitDemoStream({ droneId, streamId }: CockpitDemoStreamProps) {
  const streams = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const list = streams ?? [];
  const target =
    streamId != null
      ? list.find((s) => s.id === streamId)
      : (list.find((s) => s.id === activeId) ?? list[0]);

  // The effect reads only these primitives (not the descriptor object) so it
  // re-runs on an actual stream change, not on every store snapshot.
  const count = list.length;
  const targetId = target?.id;
  const targetIndex = target?.index ?? 0;
  const targetLabel = target?.label ?? "";
  const targetRole = target?.role;

  useEffect(() => {
    // Only a multi-stream demo node paints synthetic feeds.
    if (!isDemoMode() || count <= 1 || targetId == null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pal = paletteFor(targetRole, targetIndex);
    const label = targetLabel.toUpperCase();
    const tag = `DEMO FEED · ${targetIndex}/${count}`;
    let raf = 0;
    let start: number | null = null;

    const draw = (ts: number) => {
      if (start == null) start = ts;
      const t = (ts - start) / 1000;
      const w = (canvas.width = canvas.clientWidth || 640);
      const h = (canvas.height = canvas.clientHeight || 360);

      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, pal.a);
      grad.addColorStop(1, pal.b);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // A drifting grid for a subtle "live" feel.
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1;
      const step = 48;
      const off = (t * 14) % step;
      ctx.beginPath();
      for (let x = -step + off; x < w + step; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = -step + off; y < h + step; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // A moving scanline sweep.
      const sy = (h + 80) * (((t * 0.18) % 1 + 1) % 1) - 40;
      const sweep = ctx.createLinearGradient(0, sy - 40, 0, sy + 40);
      sweep.addColorStop(0, "rgba(255,255,255,0)");
      sweep.addColorStop(0.5, "rgba(255,255,255,0.06)");
      sweep.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sweep;
      ctx.fillRect(0, sy - 40, w, 80);

      // Centered stream label + demo tag.
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${Math.max(18, Math.round(w / 20))}px ui-monospace, monospace`;
      ctx.fillText(label, w / 2, h / 2);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillText(tag, w / 2, h / 2 + 26);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [targetId, targetIndex, targetLabel, targetRole, count]);

  if (!isDemoMode() || list.length <= 1 || !target) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
