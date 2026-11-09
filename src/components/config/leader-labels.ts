/**
 * @module config/leader-labels
 * @description Places the controller drawing's leader-line labels so none of
 * them collide. Every label goes into a gutter beside the drawing: its
 * hotspot's `label_side` when that is left or right, else the side of the
 * drawing the hotspot sits on. Within a gutter the labels keep their
 * hotspots' top-to-bottom order and are pushed apart to at least one line
 * pitch, so two labels never share a line and none sits on the artwork.
 *
 * @license GPL-3.0-only
 */

export interface LeaderInput {
  id: string;
  anchor: readonly [number, number];
  side: "left" | "right" | "top" | "bottom";
}

export interface LeaderLabel {
  id: string;
  anchor: readonly [number, number];
  side: "left" | "right";
  /** The label's text anchor point (baseline centre line). */
  x: number;
  y: number;
}

export interface LeaderLayout {
  labels: LeaderLabel[];
  /** The viewBox that holds the drawing plus both gutters. */
  viewBox: [number, number, number, number];
}

export interface LeaderOptions {
  /** The artwork's own viewBox. */
  art: readonly [number, number, number, number];
  /** Vertical distance between two label lines. */
  pitch: number;
  /** Gap between the artwork and a gutter's text. */
  gap: number;
  /** Width reserved for each gutter's text. */
  gutter: number;
}

/** Spread sorted positions to at least `pitch` apart, staying near their wishes. */
function spread(wanted: number[], pitch: number, min: number): number[] {
  const out = [...wanted];
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(out[i], i === 0 ? min : out[i - 1] + pitch);
  }
  // Pull the stack back up where the push left room above, so labels sit as
  // close to their hotspots as the pitch allows.
  for (let i = out.length - 2; i >= 0; i--) {
    out[i] = Math.min(out[i], out[i + 1] - pitch, Math.max(wanted[i], min + i * pitch));
  }
  return out;
}

export function layoutLeaderLabels(items: readonly LeaderInput[], o: LeaderOptions): LeaderLayout {
  const [ax0, ay0, aw, ah] = o.art;
  const midX = ax0 + aw / 2;
  const sideOf = (it: LeaderInput): "left" | "right" =>
    it.side === "left" || it.side === "right" ? it.side : it.anchor[0] < midX ? "left" : "right";

  const labels: LeaderLabel[] = [];
  let top = ay0;
  let bottom = ay0 + ah;
  for (const side of ["left", "right"] as const) {
    const group = items.filter((it) => sideOf(it) === side).sort((a, b) => a.anchor[1] - b.anchor[1]);
    const ys = spread(
      group.map((g) => g.anchor[1]),
      o.pitch,
      ay0,
    );
    const x = side === "left" ? ax0 - o.gap : ax0 + aw + o.gap;
    group.forEach((g, i) => {
      labels.push({ id: g.id, anchor: g.anchor, side, x, y: ys[i] });
      top = Math.min(top, ys[i] - o.pitch);
      bottom = Math.max(bottom, ys[i] + o.pitch / 2);
    });
  }
  const left = ax0 - o.gap - o.gutter;
  const width = aw + 2 * (o.gap + o.gutter);
  return { labels, viewBox: [left, top, width, bottom - top] };
}
