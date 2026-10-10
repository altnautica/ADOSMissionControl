"use client";

/**
 * @module cockpit/CockpitDemoStream
 * @description Demo-only synthetic video for the cockpit stream switcher. In
 * demo mode there is no live WebRTC, so this paints a distinct, labeled,
 * gently-animated canvas per stream — so switching the `1..N` tabs and the PiP
 * inset visibly change the picture without any hardware. It renders only in
 * demo mode, is clearly tagged "DEMO FEED", and never renders for a real node.
 *
 * {@link useDemoFeedActive} is the one answer to "is the demo feed the
 * picture": the video pane, the safety band's video cell and the top-right
 * stats all read it, so none of them reports NO VIDEO over a feed that is
 * visibly playing, and the pane does not dial real transports behind it.
 *
 * The palette comes from the cockpit's `--hud-*` roles, so the feed follows
 * the active theme (night vision included).
 *
 * Reused for both the main view (the active stream) and the PiP inset (a
 * specific stream id).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { useDemoMode } from "@/hooks/use-demo-mode";
import {
  useVideoStreamsStore,
  type StreamRole,
} from "@/stores/video-streams-store";

/**
 * True when the cockpit for `droneId` shows the synthetic demo feed: demo
 * mode on and a multi-stream demo node. False for an absent drone.
 */
export function useDemoFeedActive(droneId: string | undefined): boolean {
  const demo = useDemoMode();
  const count = useVideoStreamsStore((s) =>
    droneId ? (s.streamsByDrone[droneId]?.length ?? 0) : 0,
  );
  return demo && count > 1;
}

interface FeedPalette {
  a: string;
  b: string;
  grid: string;
  ink: string;
  inkDim: string;
}

/** A theme colour, read off the canvas's cockpit ancestor. */
function hudColour(style: CSSStyleDeclaration, role: string): string {
  return style.getPropertyValue(`--hud-${role}`).trim();
}

/**
 * A distinct tint per stream from the theme's HUD roles, so each feed reads
 * differently: thermal warm (the warn role), wide EO the good role, EO the
 * primary role. Mixed into the glass role so the picture stays dark.
 */
function paletteFor(
  el: HTMLElement,
  role: StreamRole | undefined,
  index: number,
): FeedPalette {
  const style = getComputedStyle(el);
  const accents = ["primary", "good", "warn", "lock"];
  const accentRole =
    role === "ir"
      ? "warn"
      : role === "eo_wide"
        ? "good"
        : role === "eo"
          ? "primary"
          : accents[(index - 1 + accents.length) % accents.length];
  const accent = hudColour(style, accentRole);
  const ink = hudColour(style, "ink");
  return {
    a: "black",
    b: `color-mix(in oklch, ${accent} 30%, black)`,
    grid: `color-mix(in oklch, ${accent} 16%, transparent)`,
    ink: `color-mix(in oklch, ${ink} 92%, transparent)`,
    inkDim: `color-mix(in oklch, ${ink} 55%, transparent)`,
  };
}

/**
 * Canvas 2D does not parse `color-mix()`. Resolve a CSS colour through an
 * element's computed style, which serialises it as an rgb()/color() value.
 */
function resolveColour(probe: HTMLElement, css: string): string {
  probe.style.color = css;
  return getComputedStyle(probe).color;
}

interface CockpitDemoStreamProps {
  droneId: string;
  /** Render this specific stream (the PiP inset). Omit for the active stream. */
  streamId?: string;
}

export function CockpitDemoStream({ droneId, streamId }: CockpitDemoStreamProps) {
  const active = useDemoFeedActive(droneId);
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
    if (!active || targetId == null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const label = targetLabel.toUpperCase();
    const tag = `DEMO FEED · ${targetIndex}/${count}`;
    let raf = 0;
    let start: number | null = null;
    let theme: string | null = null;
    let pal: FeedPalette | null = null;

    const draw = (ts: number) => {
      // Re-read the palette when the theme changes under a running feed.
      const current = document.documentElement.dataset.theme ?? "";
      if (pal === null || current !== theme) {
        theme = current;
        const raw = paletteFor(canvas, targetRole, targetIndex);
        pal = {
          a: resolveColour(canvas, raw.a),
          b: resolveColour(canvas, raw.b),
          grid: resolveColour(canvas, raw.grid),
          ink: resolveColour(canvas, raw.ink),
          inkDim: resolveColour(canvas, raw.inkDim),
        };
      }
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

      // Centered stream label + demo tag.
      ctx.textAlign = "center";
      ctx.fillStyle = pal.ink;
      ctx.font = `700 ${Math.max(18, Math.round(w / 20))}px ui-monospace, monospace`;
      ctx.fillText(label, w / 2, h / 2);
      ctx.fillStyle = pal.inkDim;
      ctx.font = "600 12px ui-monospace, monospace";
      ctx.fillText(tag, w / 2, h / 2 + 26);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, targetId, targetIndex, targetLabel, targetRole, count]);

  if (!active || !target) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
