"use client";

/**
 * @module vision/CockpitMarkLayer
 * @description The host-owned COMPOSITED mark layer. It draws every source's
 * marks (from `cockpit-marks-store`) plus a built-in "active target" reticle
 * for the selected detection, all letterbox-mapped onto the rendered video rect
 * in ONE SVG overlay — so a plugin (or a built-in feature) that wants to draw a
 * reticle, blobs, or a trajectory contributes MARKS instead of stacking its own
 * sandboxed iframe. Non-interactive (`pointer-events-none`): the target overlay
 * beneath owns clicks.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { computeRenderedRect } from "@/components/cockpit/VideoOverlayHost";
import {
  mapPoint,
  mapScale,
  type CockpitMark,
  type MarkFrame,
} from "@/lib/cockpit/marks";
import { useCockpitMarksStore } from "@/stores/cockpit-marks-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const ACCENT = "#63b3ff"; // electric-blue instrument ink

/** Corner-bracket length as a fraction of the shorter box side. */
const BRACKET_FRAC = 0.28;
const BRACKET_MIN = 8;
const BRACKET_MAX = 22;

export function CockpitMarkLayer({ droneId }: { droneId: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const bySource = useCockpitMarksStore((s) => s.bySource);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const measure = () =>
      setSize({ w: wrapper.clientWidth, h: wrapper.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  const frame: MarkFrame | null = useMemo(() => {
    if (
      !size ||
      !batch ||
      batch.frameWidth <= 0 ||
      batch.frameHeight <= 0 ||
      size.w <= 0 ||
      size.h <= 0
    ) {
      return null;
    }
    return {
      rect: computeRenderedRect(size.w, size.h, batch.frameWidth, batch.frameHeight),
      frameWidth: batch.frameWidth,
      frameHeight: batch.frameHeight,
    };
  }, [size, batch]);

  // Every source's marks. The designated-target lock brackets are drawn by the
  // `.det.lock` box itself (CockpitTargetOverlay), so this layer is now purely
  // the composited plugin/built-in draw-layer (reticles, blobs, trajectories).
  const marks = useMemo(() => {
    const list: CockpitMark[] = [];
    for (const m of bySource.values()) list.push(...m);
    return list;
  }, [bySource]);

  if (!size) {
    return (
      <div
        ref={wrapperRef}
        // Host-owned interactive layer (target/lead reticle marks) sits
        // ABOVE the passive plugin `video.overlay` slot (VideoOverlayHost,
        // z-10), so a sandboxed plugin iframe can never occlude it.
        className="pointer-events-none absolute inset-0 z-[12]"
        data-cockpit-layer="mark-layer"
      />
    );
  }

  return (
    <div
      ref={wrapperRef}
      // Host-owned interactive layer — see the ordering-rule comment above.
      className="pointer-events-none absolute inset-0 z-[12]"
      data-cockpit-layer="mark-layer"
    >
      <svg
        width={size.w}
        height={size.h}
        className="absolute inset-0"
        style={{ overflow: "visible" }}
      >
        {marks.map((m) => renderMark(m, size.w, size.h, frame))}
      </svg>
    </div>
  );
}

function renderMark(
  m: CockpitMark,
  cw: number,
  ch: number,
  frame: MarkFrame | null,
) {
  const space = m.space ?? "frame";
  const color = m.color ?? ACCENT;

  switch (m.kind) {
    case "box":
    case "reticle": {
      const p = mapPoint(m.x, m.y, space, cw, ch, frame);
      if (!p) return null;
      const w = mapScale(m.width, "x", space, cw, ch, frame);
      const h = mapScale(m.height, "y", space, cw, ch, frame);
      if (m.kind === "box") {
        return (
          <rect
            key={m.id}
            x={p.x}
            y={p.y}
            width={w}
            height={h}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={m.dashed ? "4 3" : undefined}
          />
        );
      }
      // reticle: four corner brackets
      const b = Math.max(BRACKET_MIN, Math.min(BRACKET_MAX, Math.min(w, h) * BRACKET_FRAC));
      const r = p.x + w;
      const bot = p.y + h;
      const seg = (d: string) => (
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
      );
      return (
        <g key={m.id}>
          {seg(`M ${p.x} ${p.y + b} L ${p.x} ${p.y} L ${p.x + b} ${p.y}`)}
          {seg(`M ${r - b} ${p.y} L ${r} ${p.y} L ${r} ${p.y + b}`)}
          {seg(`M ${p.x} ${bot - b} L ${p.x} ${bot} L ${p.x + b} ${bot}`)}
          {seg(`M ${r - b} ${bot} L ${r} ${bot} L ${r} ${bot - b}`)}
        </g>
      );
    }
    case "point": {
      const p = mapPoint(m.x, m.y, space, cw, ch, frame);
      if (!p) return null;
      return (
        <circle key={m.id} cx={p.x} cy={p.y} r={m.radius ?? 4} fill={color} />
      );
    }
    case "polyline": {
      const pts: string[] = [];
      for (const [x, y] of m.points) {
        const p = mapPoint(x, y, space, cw, ch, frame);
        if (!p) return null;
        pts.push(`${p.x},${p.y}`);
      }
      return (
        <polyline
          key={m.id}
          points={pts.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={m.width ?? 2}
        />
      );
    }
    case "label": {
      const p = mapPoint(m.x, m.y, space, cw, ch, frame);
      if (!p) return null;
      return (
        <text
          key={m.id}
          x={p.x}
          y={p.y}
          fill={color}
          fontSize={11}
          fontFamily="monospace"
        >
          {m.text}
        </text>
      );
    }
    default:
      return null;
  }
}
