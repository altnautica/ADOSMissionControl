/**
 * @module cockpit/marks
 * @description The cockpit mark model. A "mark" is a lightweight vector
 * primitive (box, reticle, point, polyline, label) that the host composites
 * into ONE letterbox-correct overlay layer (`CockpitMarkLayer`), instead of a
 * plugin drawing its own boxes inside a separate sandboxed iframe. Built-in
 * features and (via a host adapter) plugins push marks into the shared
 * `cockpit-marks-store`; the layer maps them onto the rendered video rect and
 * draws them together.
 *
 * Coordinate space per mark:
 *  - `"frame"` (default): source-frame pixels, in the detection frame's own
 *    resolution — letterbox-mapped onto the rendered video rect exactly like a
 *    detection box. Requires a detection frame to map against.
 *  - `"normalized"`: 0..1 of the overlay container — placed directly, so a mark
 *    that is not tied to the video frame (a fixed HUD reticle) needs no frame.
 *
 * @license GPL-3.0-only
 */

/** Which coordinate space a mark's numbers are in. */
export type MarkSpace = "frame" | "normalized";

interface MarkBase {
  /** Unique within its source. */
  id: string;
  /** Coordinate space; defaults to `"frame"`. */
  space?: MarkSpace;
  /** CSS color; defaults to the accent. */
  color?: string;
}

/** A rectangle (x/y top-left, width/height). */
export interface BoxMark extends MarkBase {
  kind: "box";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Dashed stroke (e.g. an unconfirmed region). */
  dashed?: boolean;
}

/** Corner brackets around a rect — the "active target" reticle. */
export interface ReticleMark extends MarkBase {
  kind: "reticle";
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A small filled dot. */
export interface PointMark extends MarkBase {
  kind: "point";
  x: number;
  y: number;
  /** Radius in container px; defaults to 4. */
  radius?: number;
}

/** A connected path (e.g. a VIO trajectory). */
export interface PolylineMark extends MarkBase {
  kind: "polyline";
  points: ReadonlyArray<readonly [number, number]>;
  /** Stroke width in px; defaults to 2. */
  width?: number;
}

/** A short text label anchored at a point. */
export interface LabelMark extends MarkBase {
  kind: "label";
  x: number;
  y: number;
  text: string;
}

export type CockpitMark =
  | BoxMark
  | ReticleMark
  | PointMark
  | PolylineMark
  | LabelMark;

/** The rendered video rect a `"frame"`-space mark maps onto. */
export interface MarkFrame {
  /** Rendered video rect within the container (letterbox-corrected). */
  rect: { left: number; top: number; width: number; height: number };
  /** The detection frame's own resolution the mark's px are in. */
  frameWidth: number;
  frameHeight: number;
}

/** Map an (x, y) in a mark's space to container pixels. `frame` may be null
 * for `"normalized"` marks (which need only the container size). */
export function mapPoint(
  x: number,
  y: number,
  space: MarkSpace,
  containerW: number,
  containerH: number,
  frame: MarkFrame | null,
): { x: number; y: number } | null {
  if (space === "normalized") {
    return { x: x * containerW, y: y * containerH };
  }
  if (!frame || frame.frameWidth <= 0 || frame.frameHeight <= 0) return null;
  const sx = frame.rect.width / frame.frameWidth;
  const sy = frame.rect.height / frame.frameHeight;
  return { x: frame.rect.left + x * sx, y: frame.rect.top + y * sy };
}

/** Upper bound on marks accepted from one source in a single post — a defence
 * against a runaway plugin flooding the composited layer. */
export const MAX_MARKS_PER_SOURCE = 512;

/** Points kept from one polyline; the rest are dropped. */
export const MAX_POINTS_PER_POLYLINE = 1024;

/** Polyline points accepted from one source across all its marks in one post. */
export const MAX_POINTS_PER_SOURCE = 4096;

/** Characters kept from one label's text. */
export const MAX_LABEL_CHARS = 64;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function readSpace(v: unknown): MarkSpace | undefined {
  return v === "frame" || v === "normalized" ? v : undefined;
}

/** Parse ONE untrusted value into a mark, or `null` when it is malformed. */
function parseMark(value: unknown): CockpitMark | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return null;
  const base = {
    id: v.id,
    ...(readSpace(v.space) ? { space: readSpace(v.space) } : {}),
    ...(typeof v.color === "string" ? { color: v.color } : {}),
  };

  switch (v.kind) {
    case "box":
    case "reticle": {
      if (
        !isFiniteNumber(v.x) ||
        !isFiniteNumber(v.y) ||
        !isFiniteNumber(v.width) ||
        !isFiniteNumber(v.height)
      ) {
        return null;
      }
      if (v.kind === "box") {
        return {
          ...base,
          kind: "box",
          x: v.x,
          y: v.y,
          width: v.width,
          height: v.height,
          ...(typeof v.dashed === "boolean" ? { dashed: v.dashed } : {}),
        };
      }
      return { ...base, kind: "reticle", x: v.x, y: v.y, width: v.width, height: v.height };
    }
    case "point": {
      if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
      return {
        ...base,
        kind: "point",
        x: v.x,
        y: v.y,
        ...(isFiniteNumber(v.radius) ? { radius: v.radius } : {}),
      };
    }
    case "polyline": {
      if (!Array.isArray(v.points) || v.points.length === 0) return null;
      const points: Array<[number, number]> = [];
      for (const p of v.points.slice(0, MAX_POINTS_PER_POLYLINE)) {
        if (
          !Array.isArray(p) ||
          p.length < 2 ||
          !isFiniteNumber(p[0]) ||
          !isFiniteNumber(p[1])
        ) {
          return null;
        }
        points.push([p[0], p[1]]);
      }
      return {
        ...base,
        kind: "polyline",
        points,
        ...(isFiniteNumber(v.width) ? { width: v.width } : {}),
      };
    }
    case "label": {
      if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || typeof v.text !== "string") {
        return null;
      }
      return { ...base, kind: "label", x: v.x, y: v.y, text: v.text.slice(0, MAX_LABEL_CHARS) };
    }
    default:
      return null;
  }
}

/**
 * Parse an untrusted marks payload (from a sandboxed plugin iframe over the
 * bridge) into a validated `CockpitMark[]`. Non-array input yields `[]`;
 * malformed entries are dropped; the list is capped at
 * {@link MAX_MARKS_PER_SOURCE}, each polyline at {@link MAX_POINTS_PER_POLYLINE}
 * points and all polylines together at {@link MAX_POINTS_PER_SOURCE}, and label
 * text at {@link MAX_LABEL_CHARS}. This is the host's guard on the mark
 * contract — a plugin posts marks and the host composites the valid ones.
 */
export function parseCockpitMarks(value: unknown): CockpitMark[] {
  if (!Array.isArray(value)) return [];
  const out: CockpitMark[] = [];
  let pointBudget = MAX_POINTS_PER_SOURCE;
  for (const item of value) {
    if (out.length >= MAX_MARKS_PER_SOURCE) break;
    const mark = parseMark(item);
    if (!mark) continue;
    if (mark.kind === "polyline") {
      if (pointBudget === 0) continue;
      if (mark.points.length > pointBudget) mark.points = mark.points.slice(0, pointBudget);
      pointBudget -= mark.points.length;
    }
    out.push(mark);
  }
  return out;
}

/** Scale a frame-space length (width/height) to container px along an axis. */
export function mapScale(
  value: number,
  axis: "x" | "y",
  space: MarkSpace,
  containerW: number,
  containerH: number,
  frame: MarkFrame | null,
): number {
  if (space === "normalized") return value * (axis === "x" ? containerW : containerH);
  if (!frame || frame.frameWidth <= 0 || frame.frameHeight <= 0) return 0;
  return axis === "x"
    ? value * (frame.rect.width / frame.frameWidth)
    : value * (frame.rect.height / frame.frameHeight);
}
