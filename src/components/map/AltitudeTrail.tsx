/**
 * @module AltitudeTrail
 * @description Renders the drone trail as color-coded polyline segments based
 * on relative altitude. Low = green, mid = yellow, high = red. Falls back to
 * the standard accent blue trail when no altitude data is available.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { Polyline, Tooltip } from "react-leaflet";
import { useTrailStore, type TrailPoint } from "@/stores/trail-store";

/** Altitude band thresholds in meters AGL. */
const ALT_LOW = 10;
const ALT_MID = 50;
const ALT_HIGH = 120;

/**
 * How many discrete colour bands the gradient is quantised into.
 *
 * This is the whole performance story of this component. `altitudeColor`
 * used to interpolate CONTINUOUSLY, so two consecutive telemetry samples a
 * few centimetres apart produced two different `rgb(...)` strings, the
 * "same colour as the previous point?" test in `buildSegments` essentially
 * never held, and every trail point became its own `<Polyline>` — an SVG
 * path plus a `<Tooltip>` per sample. A 2000-point trail meant ~2000 live
 * Leaflet layers, each re-projected on every pan and zoom.
 *
 * Quantising first means a climb through the whole range produces at most
 * this many segments, and level flight produces one, while the rendered
 * gradient is visually unchanged at 2.5 px stroke width.
 */
const BANDS = 16;
const BAND_HEIGHT_M = ALT_HIGH / BANDS;

/**
 * Dead zone around a band edge, in metres.
 *
 * Quantising alone is not enough: a hover sitting exactly on a boundary
 * (30 m is one, with 7.5 m bands) flaps between two bands on sub-decimetre
 * jitter and reproduces the per-sample-layer explosion in miniature. A
 * sample only leaves the current band once it is this far past the edge.
 */
const BAND_HYSTERESIS_M = 1;

/** The band index an altitude falls in, ignoring hysteresis. */
function altitudeBand(alt: number): number {
  if (!Number.isFinite(alt)) return 0;
  const clamped = Math.min(Math.max(alt, 0), ALT_HIGH);
  return Math.min(Math.floor(clamped / BAND_HEIGHT_M), BANDS - 1);
}

/**
 * The band to draw `alt` in, given the band the trail is currently in.
 * Stays put until `alt` clears the current band's edge by the dead zone.
 */
function nextBand(alt: number, current: number): number {
  const value = Number.isFinite(alt) ? alt : 0;
  const low = current * BAND_HEIGHT_M - BAND_HYSTERESIS_M;
  const high = (current + 1) * BAND_HEIGHT_M + BAND_HYSTERESIS_M;
  if (value >= low && value < high) return current;
  return altitudeBand(value);
}

/** Colour for a band, on a green-yellow-red gradient through its midpoint. */
function bandColor(band: number): string {
  const mid = (band + 0.5) * BAND_HEIGHT_M;
  if (mid <= ALT_LOW) return "#22c55e"; // green
  if (mid <= ALT_MID) {
    // green to yellow
    const t = (mid - ALT_LOW) / (ALT_MID - ALT_LOW);
    const r = Math.round(34 + t * (234 - 34));
    const g = Math.round(197 + t * (179 - 197));
    const b = Math.round(94 + t * (8 - 94));
    return `rgb(${r},${g},${b})`;
  }
  // yellow to red
  const t = (mid - ALT_MID) / (ALT_HIGH - ALT_MID);
  const r = Math.round(234 + t * (239 - 234));
  const g = Math.round(179 - t * 179);
  const b = Math.round(8 - t * 8);
  return `rgb(${r},${g},${b})`;
}

interface TrailSegment {
  positions: [number, number][];
  color: string;
  avgAlt: number;
}

/** A trail point whose height above home was reported. */
type AltTrailPoint = TrailPoint & { alt: number };

/** True when every point carries a reported altitude. */
function everyPointHasAlt(trail: readonly TrailPoint[]): trail is readonly AltTrailPoint[] {
  return trail.every((p) => p.alt !== undefined);
}

/** Group consecutive trail points into segments sharing one altitude band. */
export function buildSegments(trail: readonly AltTrailPoint[]): TrailSegment[] {
  if (trail.length < 2) return [];

  const segments: TrailSegment[] = [];
  let currentBand = altitudeBand(trail[0].alt);
  let currentPositions: [number, number][] = [[trail[0].lat, trail[0].lon]];
  let altSum = trail[0].alt;
  let altCount = 1;

  for (let i = 1; i < trail.length; i++) {
    const band = nextBand(trail[i].alt, currentBand);
    const pos: [number, number] = [trail[i].lat, trail[i].lon];

    if (band === currentBand) {
      currentPositions.push(pos);
      altSum += trail[i].alt;
      altCount++;
    } else {
      // Close current segment (overlap the last point for continuity)
      segments.push({
        positions: currentPositions,
        color: bandColor(currentBand),
        avgAlt: altSum / altCount,
      });
      // Start new segment from previous point
      currentPositions = [currentPositions[currentPositions.length - 1], pos];
      currentBand = band;
      altSum = trail[i].alt;
      altCount = 1;
    }
  }

  // Push final segment
  if (currentPositions.length >= 2) {
    segments.push({
      positions: currentPositions,
      color: bandColor(currentBand),
      avgAlt: altSum / altCount,
    });
  }

  return segments;
}

export function AltitudeTrail() {
  // The ring is a stable ref mutated in place, so re-read it when the version
  // bumps. Deriving the trail through a memo keeps its identity stable, which
  // lets everything below key off it directly instead of off the version.
  const ring = useTrailStore((s) => s._ring);
  const version = useTrailStore((s) => s._version);

  const trail = useMemo(() => {
    void version; // the ring mutates in place; the version is the trigger
    return ring.toArray();
  }, [ring, version]);

  // Colour by altitude only when every point reported one; a point with no
  // height above home must not be painted into a band.
  const segments = useMemo(
    () => (everyPointHasAlt(trail) && trail.some((p) => p.alt !== 0) ? buildSegments(trail) : null),
    [trail],
  );
  const hasAltData = segments !== null;

  // No altitude data — one plain accent-blue polyline for the whole track.
  const flatPositions = useMemo<[number, number][]>(
    () => (hasAltData ? [] : trail.map((p) => [p.lat, p.lon])),
    [trail, hasAltData],
  );

  if (!hasAltData) {
    if (flatPositions.length < 2) return null;
    return (
      <Polyline
        positions={flatPositions}
        pathOptions={{ color: "#3A82FF", weight: 2, opacity: 0.7 }}
      />
    );
  }

  return (
    <>
      {segments.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg.positions}
          pathOptions={{
            color: seg.color,
            weight: 2.5,
            opacity: 0.85,
          }}
        >
          <Tooltip direction="top" sticky>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
              ~{seg.avgAlt.toFixed(0)}m AGL
            </span>
          </Tooltip>
        </Polyline>
      ))}
    </>
  );
}
