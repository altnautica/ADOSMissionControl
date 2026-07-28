/**
 * @module command/swarm-view/marquee
 * @description Drag-rectangle selection over the fleet map.
 *
 * Two modes, chosen by drag direction, because that is the convention every
 * operator already has in their fingers from CAD, GIS and RTS games: a drag
 * that runs NW→SE is a WINDOW and takes only icons it fully encloses; a drag
 * that reverses on either axis is a CROSSING and takes anything it touches.
 * Getting this backwards is how an operator selects six drones and commands
 * eight, so the rule is pure and tested rather than felt out in the browser.
 *
 * Coordinates are container-relative pixels. Icons are squares centred on their
 * projected position, matching what `SwarmFleetMap` actually draws — a
 * containment test against the anchor point alone would call a half-covered
 * icon "enclosed".
 *
 * @license GPL-3.0-only
 */

export interface MarqueeRect {
  /** Where the drag started. */
  x1: number;
  y1: number;
  /** Where the pointer is now. */
  x2: number;
  y2: number;
}

export interface MarqueePoint {
  slot: number;
  /** Icon centre, container-relative pixels. */
  x: number;
  y: number;
}

/** A drag under this many pixels on both axes is a click, not a marquee. */
export const MARQUEE_MIN_DRAG_PX = 4;

/**
 * True when the drag ran NW→SE on both axes — the window/enclose gesture.
 * Any reversal makes it a crossing drag, per the convention above.
 */
export function isEnclosingDrag(rect: MarqueeRect): boolean {
  return rect.x2 >= rect.x1 && rect.y2 >= rect.y1;
}

/** The rectangle's normalised edges, whichever way it was dragged. */
export function marqueeBounds(rect: MarqueeRect): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return {
    left: Math.min(rect.x1, rect.x2),
    top: Math.min(rect.y1, rect.y2),
    right: Math.max(rect.x1, rect.x2),
    bottom: Math.max(rect.y1, rect.y2),
  };
}

/**
 * The slots a drag selects.
 *
 * `iconSize` is the icon's full edge length; each icon is treated as the square
 * of that size centred on its point, so "fully contained" means the whole glyph
 * is inside the rubber band and "touched" means any part of it overlaps.
 */
export function marqueeSelection(
  rect: MarqueeRect,
  points: readonly MarqueePoint[],
  iconSize: number,
): number[] {
  const { left, top, right, bottom } = marqueeBounds(rect);
  const half = iconSize / 2;
  const enclose = isEnclosingDrag(rect);

  const hits: number[] = [];
  for (const point of points) {
    const inside = enclose
      ? point.x - half >= left &&
        point.x + half <= right &&
        point.y - half >= top &&
        point.y + half <= bottom
      : point.x + half >= left &&
        point.x - half <= right &&
        point.y + half >= top &&
        point.y - half <= bottom;
    if (inside) hits.push(point.slot);
  }
  return hits;
}

/** Whether the pointer has moved far enough for this to be a marquee at all. */
export function isMarqueeDrag(rect: MarqueeRect): boolean {
  return (
    Math.abs(rect.x2 - rect.x1) >= MARQUEE_MIN_DRAG_PX ||
    Math.abs(rect.y2 - rect.y1) >= MARQUEE_MIN_DRAG_PX
  );
}
