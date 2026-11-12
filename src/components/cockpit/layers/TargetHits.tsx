"use client";

/**
 * @module cockpit/layers/TargetHits
 * @description The click areas over the `targets` layer's glyphs: one button
 * per target, at least the spec's `touch_target.min` and padded around the
 * box. The buttons stay out of the Tab sequence, so Tab walks the
 * flight-screen chrome first; the boxes are reached with `[` / `]` and opened
 * with Enter.
 *
 * @license GPL-3.0-only
 */

import type { MouseEvent } from "react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import type { ScreenRect } from "@/lib/vision/target-geometry";
import type { GlyphLayout } from "@/lib/vision/target-layout";
import type { DrawItem } from "@/lib/vision/target-state";

export type HitLayout = GlyphLayout & { hit: ScreenRect };

/** The smallest hit area a target takes (`layout.json` `touch_target.min`). */
const HIT_MIN = layoutSpec.touch_target.min;

/** A target's hit rect grown about its centre to at least {@link HIT_MIN}. */
export function padHit(r: ScreenRect): ScreenRect {
  const w = Math.max(r.w, HIT_MIN);
  const h = Math.max(r.h, HIT_MIN);
  return { x: r.x - (w - r.w) / 2, y: r.y - (h - r.h) / 2, w, h };
}

export function TargetHits({
  hits,
  onHitClick,
  onHover,
}: {
  hits: readonly HitLayout[];
  onHitClick: (e: MouseEvent, item: DrawItem) => void;
  onHover: (key: string | null) => void;
}) {
  return (
    <>
      {hits.map((l) => {
        const hit = padHit(l.hit);
        return (
          <button
            key={l.key}
            type="button"
            className="tgt-hit"
            tabIndex={-1}
            data-target-interactive
            data-kind={l.kind}
            data-key={l.key}
            aria-label={l.item.topTag?.text ?? l.item.detection?.classLabel ?? l.kind}
            style={{ left: hit.x, top: hit.y, width: hit.w, height: hit.h }}
            onClick={(e) => onHitClick(e, l.item)}
            onPointerEnter={() => onHover(l.key)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(l.key)}
            onBlur={() => onHover(null)}
          />
        );
      })}
    </>
  );
}
