"use client";

/**
 * @module vision/TargetGlyph
 * @description Draws one HUD target item (a laid-out resolver `DrawItem`):
 * brackets or hairline, reticle, feet tick, search ring and sweep, off-frame
 * arrow, ghost path and focus ring as SVG, and its tags as HTML plates so the
 * plate blur applies. Every line is painted twice (outline, then state
 * colour). Colours, dash patterns and fades come from the `.tgt-layer` rules
 * in `globals.css`, keyed on `data-kind` and the modifier attributes. The
 * glyph is purely visual: hit areas belong to the overlay.
 *
 * @license GPL-3.0-only
 */

import type { CSSProperties } from "react";

import { FOCUS_OFFSET, sweepArcPath } from "@/lib/vision/target-geometry";
import type { GlyphLayout, PlacedTag } from "@/lib/vision/target-layout";
import { LOST_FADE_MS } from "@/lib/vision/target-state";

/** Outline first, then the state-coloured stroke. */
function Outlined({ d, className }: { d: string; className?: string }) {
  return (
    <g className={className}>
      <path className="tgt-o" d={d} />
      <path className="tgt-s" d={d} />
    </g>
  );
}

function Tag({ tag, part }: { tag: PlacedTag; part: "top" | "bottom" }) {
  return (
    <span
      className="tgt-tag"
      data-tone={tag.tone}
      data-part={part}
      style={{ left: tag.x, top: tag.y, minWidth: tag.w, height: tag.h }}
    >
      {tag.text}
    </span>
  );
}

export interface TargetGlyphProps {
  layout: GlyphLayout;
  reducedMotion: boolean;
  focused?: boolean;
}

export function TargetGlyph({ layout: l, reducedMotion, focused = false }: TargetGlyphProps) {
  const { item, box } = l;
  const mods = item.modifiers;
  const style: CSSProperties & Record<"--tgt-font", string> = { "--tgt-font": `${l.fontPx}px` };
  if (item.kind === "LOST" && item.lostProgress !== undefined && !reducedMotion) {
    // The fade runs in CSS; a negative delay starts it at the elapsed share.
    style.animationDelay = `${-Math.round(item.lostProgress * LOST_FADE_MS)}ms`;
  }
  const snap = mods.reacquired && !reducedMotion;
  const hairline = item.kind === "CANDIDATE" || item.kind === "GT";
  const focusRect = box
    ? { x: box.x - FOCUS_OFFSET, y: box.y - FOCUS_OFFSET, w: box.w + 2 * FOCUS_OFFSET, h: box.h + 2 * FOCUS_OFFSET }
    : l.arrow
      ? { x: l.arrow.x - 10, y: l.arrow.y - 10, w: 20, h: 20 }
      : null;

  return (
    <div
      className="tgt"
      data-kind={item.kind}
      data-key={l.key}
      data-uncertain={mods.uncertain || undefined}
      data-follow-stale={mods.followStale || undefined}
      data-reacquired={mods.reacquired || undefined}
      data-reduced-motion={reducedMotion || undefined}
      data-box={box ? [box.x, box.y, box.w, box.h].map((v) => v.toFixed(2)).join(",") : undefined}
      style={style}
    >
      <svg className="tgt-svg" aria-hidden="true">
        {l.ghost.length > 1 && (
          <polyline className="tgt-ghost" points={l.ghost.map((p) => `${p.x},${p.y}`).join(" ")} />
        )}
        {box && hairline && (
          <g className="tgt-hairline">
            <rect className="tgt-o" x={box.x} y={box.y} width={box.w} height={box.h} />
            <rect className="tgt-s" x={box.x} y={box.y} width={box.w} height={box.h} />
          </g>
        )}
        {l.brackets && (
          <Outlined d={l.brackets} className={snap ? "tgt-brackets tgt-snap" : "tgt-brackets"} />
        )}
        {l.reticle && <Outlined d={l.reticle} className="tgt-reticle" />}
        {l.feet && <Outlined d={l.feet} className="tgt-feet" />}
        {l.ring && (
          <g className="tgt-ring" data-static={reducedMotion || undefined}>
            <circle className="tgt-o" cx={l.ring.cx} cy={l.ring.cy} r={l.ring.r} />
            <circle className="tgt-s" cx={l.ring.cx} cy={l.ring.cy} r={l.ring.r} />
            {!reducedMotion && (
              <g className="tgt-sweep" style={{ transformOrigin: `${l.ring.cx}px ${l.ring.cy}px` }}>
                <Outlined d={sweepArcPath(l.ring.cx, l.ring.cy, l.ring.r)} />
              </g>
            )}
          </g>
        )}
        {l.arrow && <path className="tgt-arrow" d={l.arrow.path} />}
        {focused && focusRect && (
          <rect
            className="tgt-focus"
            x={focusRect.x}
            y={focusRect.y}
            width={focusRect.w}
            height={focusRect.h}
          />
        )}
      </svg>
      {l.topTag && <Tag tag={l.topTag} part="top" />}
      {l.bottomTags.map((t, i) => (
        <Tag key={i} tag={t} part="bottom" />
      ))}
    </div>
  );
}
