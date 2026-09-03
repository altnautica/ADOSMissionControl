/**
 * @module simulation/log-track
 * @description Pure log-file -> flown-track extraction, shared by the parse
 * worker and the main-thread fallback.
 *
 * Kept free of React, Zustand and DOM so it can run inside a `Worker`. Parsing a
 * multi-hundred-megabyte dataflash log takes seconds; doing it on the main
 * thread froze the whole UI, which is why the caller hands this to a worker.
 *
 * Failures are TYPED, not collapsed into one opaque code: a truncated log, an
 * unrecognised format and a genuinely corrupt file need three different operator
 * responses, and previously all three read as "parse failed".
 *
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import { parseDataflashLog } from "@/lib/dataflash/parser";
import { dataflashToFlightRecords } from "@/lib/dataflash/to-flight-record";
import { parseUlog } from "@/lib/ulog/parser";
import { ulogToFlightRecords } from "@/lib/ulog/to-flight-record";
import { parseTlog, tlogToFlightRecord } from "@/lib/tlog/parser";

/** A single ordered point of the flown track. `alt` is the logged altitude in metres. */
export interface TrackPoint {
  lat: number;
  lon: number;
  alt: number;
  /**
   * True when `alt` is an absolute MSL/AMSL altitude (the log's `alt` channel);
   * false when it is the `relativeAlt` fallback (height above home, already
   * ellipsoidal-ish for placement). Lets the Cesium overlay geoid-correct only
   * the AMSL points so the flown track does not float off the plan by the geoid
   * undulation.
   */
  amsl?: boolean;
}

/**
 * Why a log could not be turned into a track. Each variant carries the detail
 * an operator needs to act:
 * - `unsupported`  — the extension or the file's own magic bytes say this is
 *                    not a log format we read.
 * - `truncated`    — the file ends mid-record at `offset` bytes; the flight was
 *                    cut short (pulled SD card, power loss), which is a
 *                    completely different situation from a corrupt file.
 * - `no-positions` — the log parsed but carried fewer than two GPS-fixed
 *                    positions, so there is no path to draw.
 * - `parse-failed` — the parser rejected the content for some other reason.
 */
export type LogTrackError =
  | { code: "unsupported"; detail: string }
  | { code: "truncated"; offset: number }
  | { code: "no-positions"; found: number }
  | { code: "parse-failed"; detail: string };

/** Outcome of {@link parseLogTrack}. */
export type LogTrackResult =
  | { ok: true; positions: TrackPoint[] }
  | { ok: false; error: LogTrackError };

/** True when a lat/lon pair is a plausible real fix (finite, in range, not the 0/0 null-island no-fix). */
function isValidFix(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
}

/**
 * Extract an ordered position array from parsed telemetry frames.
 *
 * Reads only `position` / `globalPosition` channel frames (the parsers emit
 * these from ArduPilot POS / MAVLink GLOBAL_POSITION_INT rows), preferring the
 * absolute `alt` and falling back to `relativeAlt` so the overlay sits at a
 * defensible height. Frames without a valid GPS fix are skipped — never faked.
 */
export function extractPositions(frames: TelemetryFrame[]): TrackPoint[] {
  const positions: TrackPoint[] = [];
  for (const frame of frames) {
    if (frame.channel !== "position" && frame.channel !== "globalPosition") continue;
    const d = frame.data as Record<string, unknown>;
    const lat = typeof d.lat === "number" ? d.lat : NaN;
    const lon = typeof d.lon === "number" ? d.lon : NaN;
    if (!isValidFix(lat, lon)) continue;
    // The absolute `alt` channel is MSL/AMSL and needs geoid correction for
    // Cesium placement; the `relativeAlt` fallback is height-above-home and does
    // not. Tag the point so the overlay only corrects the AMSL ones.
    let alt: number;
    let amsl: boolean;
    if (typeof d.alt === "number") {
      alt = d.alt;
      amsl = true;
    } else if (typeof d.relativeAlt === "number") {
      alt = d.relativeAlt;
      amsl = false;
    } else {
      alt = 0;
      amsl = false;
    }
    positions.push({ lat, lon, alt, amsl });
  }
  return positions;
}

/** Lowercase file extension (without the dot), or "". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Classify a thrown parser error.
 *
 * A `DataView`/`TypedArray` bounds failure means the parser walked off the end
 * of the buffer, i.e. the last record is incomplete — the file is truncated, and
 * the byte length is the honest offset at which the data ran out. A magic-byte
 * rejection means the content is not the format the extension claimed.
 */
function classifyParseError(err: unknown, byteLength: number): LogTrackError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof RangeError || /outside the bounds|out of range|offset is outside/i.test(message)) {
    return { code: "truncated", offset: byteLength };
  }
  if (/bad magic|not a .* file|invalid header/i.test(message)) {
    return { code: "unsupported", detail: message };
  }
  return { code: "parse-failed", detail: message };
}

/**
 * Parse a raw log buffer into a flown track. `ext` is the lowercase extension
 * without the dot. Never throws: every failure comes back as a typed error.
 */
export function parseLogTrack(ext: string, buffer: ArrayBuffer, name: string): LogTrackResult {
  let positions: TrackPoint[];
  try {
    if (ext === "bin" || ext === "log") {
      // ArduPilot DataFlash binary. Parsed in-memory and frames pulled directly
      // — deliberately NOT via import.ts, which also persists to IndexedDB.
      const log = parseDataflashLog(new Uint8Array(buffer));
      const flights = dataflashToFlightRecords(log, { sourceFilename: name });
      positions = extractPositions(flights.flatMap((f) => f.frames));
    } else if (ext === "ulg") {
      const log = parseUlog(buffer);
      const flights = ulogToFlightRecords(log, name);
      positions = extractPositions(flights.flatMap((f) => f.frames));
    } else if (ext === "tlog") {
      const packets = parseTlog(buffer);
      const result = tlogToFlightRecord(packets, name);
      positions = result ? extractPositions(result.frames) : [];
    } else {
      return { ok: false, error: { code: "unsupported", detail: ext || "(no extension)" } };
    }
  } catch (err) {
    return { ok: false, error: classifyParseError(err, buffer.byteLength) };
  }

  if (positions.length < 2) {
    return { ok: false, error: { code: "no-positions", found: positions.length } };
  }
  return { ok: true, positions };
}

/** Default rendering tolerance: 2 m of cross-track error is invisible on screen. */
export const DEFAULT_TRACK_TOLERANCE_M = 2;

/** Metres per degree of latitude — good to ~0.3% anywhere, plenty for a screen tolerance. */
const M_PER_DEG_LAT = 111_320;

/**
 * Simplify a flown track for RENDERING with Douglas–Peucker, keeping every
 * point whose cross-track deviation exceeds `toleranceM`.
 *
 * A raw log carries a position at 5-10 Hz, so an hour of flight is tens of
 * thousands of vertices in one Cesium polyline — all of them submitted every
 * frame, most of them sub-metre apart and invisible. The full-resolution array
 * stays available for analysis; only the draw path uses this.
 *
 * Iterative (explicit stack) so a 100k-point track cannot blow the call stack.
 */
export function decimateTrack(
  points: readonly TrackPoint[],
  toleranceM: number = DEFAULT_TRACK_TOLERANCE_M,
): TrackPoint[] {
  if (points.length <= 2 || toleranceM <= 0) return [...points];

  // Work in a local metric plane: longitude degrees shrink by cos(latitude).
  const lonScale = Math.cos((points[0].lat * Math.PI) / 180);
  const x = (p: TrackPoint) => p.lon * M_PER_DEG_LAT * lonScale;
  const y = (p: TrackPoint) => p.lat * M_PER_DEG_LAT;
  const tol2 = toleranceM * toleranceM;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const segment = stack.pop();
    if (!segment) break;
    const [first, last] = segment;
    if (last <= first + 1) continue;

    const ax = x(points[first]);
    const ay = y(points[first]);
    const bx = x(points[last]);
    const by = y(points[last]);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let worstIndex = -1;
    let worstDist2 = 0;
    for (let i = first + 1; i < last; i++) {
      const px = x(points[i]) - ax;
      const py = y(points[i]) - ay;
      // Squared perpendicular distance to the segment (degenerate segment ->
      // plain distance from the shared endpoint).
      let dist2: number;
      if (lenSq === 0) {
        dist2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
        const ox = px - t * dx;
        const oy = py - t * dy;
        dist2 = ox * ox + oy * oy;
      }
      if (dist2 > worstDist2) {
        worstDist2 = dist2;
        worstIndex = i;
      }
    }

    if (worstIndex !== -1 && worstDist2 > tol2) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  const out: TrackPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i] === 1) out.push(points[i]);
  }
  return out;
}
