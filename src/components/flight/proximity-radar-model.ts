/**
 * @module flight/proximity-radar-model
 * @description Pure view model for the proximity radar: the OBSTACLE_DISTANCE
 * wedges and their measured-distance arcs, the companion scan dots, the
 * 3 / 6 / 12 m display range, the range rings and the nearest-obstacle
 * readout. The component renders exactly what this returns.
 *
 * @license GPL-3.0-only
 */

import type { NavScan, NavState } from "@/lib/agent/nav-types";
import {
  RADAR_CAUTION_M,
  RADAR_DANGER_M,
  RADAR_MAX_DOTS,
  RADAR_MAX_DOTS_LOW_POWER,
  autoRadarScale,
  nearestScanM,
  radarBand,
  radarScanDots,
  type RadarBand,
  type RadarScale,
  type RadarScaleSetting,
} from "@/lib/nav/radar-geometry";
import { obstacleSweep, type ObstacleReference } from "@/lib/telemetry/obstacle-sweep";
import type { ObstacleData } from "@/lib/types/telemetry";
import { NAV_STATE_STALE_MS, SCAN_STALE_MS, type Stamped } from "@/stores/nav-stream-store";

/** Both sources older than this: the dial dims and the readout shows `—`. */
export const RADAR_STALE_MS = 2000;

/** Dial size (px) per cockpit width class. */
export const RADAR_SIZE_BY_CLASS = { compact: 88, medium: 100, expanded: 140, tv: 176 } as const;

/** Dial geometry for a square of `size` px: centre, outer and inner radius. */
export function radarDial(size: number): { c: number; R: number; inner: number } {
  return { c: size / 2, R: (size * 52) / 120, inner: (size * 16) / 120 };
}

export interface RadarModelInput {
  size: number;
  now: number;
  /** Latest OBSTACLE_DISTANCE sample, whatever its age. */
  obstacle: ObstacleData | undefined;
  /** Latest scan from the nav feed, whatever its age. */
  scan: Stamped<NavScan> | undefined;
  nav: Stamped<NavState> | null;
  /** Vehicle heading (deg) when fresh; rotates north-aligned sectors. */
  yawDeg: number | null;
  setting: RadarScaleSetting;
  lowPower: boolean;
}

export interface RadarSectorView {
  wedge: string;
  /** The 2 px arc at the measured distance; null when beyond the dial. */
  arc: string | null;
  tone: "crit" | "warn";
}

export interface RadarModel {
  hidden: boolean;
  stale: boolean;
  reference: ObstacleReference;
  displayM: RadarScale;
  rings: Array<{ r: number; label: string; lx: number; ly: number }>;
  sectors: RadarSectorView[];
  dots: Array<{ x: number; y: number }>;
  nearestM: number | null;
  band: RadarBand;
  rateHz: number | null;
}

function within(at: number, now: number, maxAgeMs: number): boolean {
  const age = now - at;
  return age <= maxAgeMs && age >= -maxAgeMs;
}

function polar(c: number, deg: number, r: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [c + r * Math.sin(rad), c - r * Math.cos(rad)];
}

function wedgePath(c: number, a: number, b: number, rOut: number, rIn: number): string {
  const large = b - a > 180 ? 1 : 0;
  const [ox1, oy1] = polar(c, a, rOut);
  const [ox2, oy2] = polar(c, b, rOut);
  const [ix2, iy2] = polar(c, b, rIn);
  const [ix1, iy1] = polar(c, a, rIn);
  return `M ${ox1} ${oy1} A ${rOut} ${rOut} 0 ${large} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${rIn} ${rIn} 0 ${large} 0 ${ix1} ${iy1} Z`;
}

function arcPath(c: number, a: number, b: number, r: number): string {
  const [x1, y1] = polar(c, a, r);
  const [x2, y2] = polar(c, b, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

function minOf(...values: Array<number | null>): number | null {
  let best: number | null = null;
  for (const v of values) if (v !== null && (best === null || v < best)) best = v;
  return best;
}

export function buildRadarModel(input: RadarModelInput): RadarModel {
  const { size, now } = input;
  const { c, R, inner } = radarDial(size);
  const obstacleFresh =
    input.obstacle && within(input.obstacle.timestamp, now, RADAR_STALE_MS) ? input.obstacle : null;
  const scanRecent =
    input.scan && within(input.scan.receivedAt, now, RADAR_STALE_MS) ? input.scan.data : null;
  const sweep = obstacleFresh ? obstacleSweep(obstacleFresh) : null;
  const stale = !sweep && !scanRecent;

  // Body-frame data puts the nose at the top. North-aligned sectors are
  // rotated into the body frame when a scan is drawn with them; without a
  // heading the dial stays north-up and the scan is not drawn.
  const northSweep = sweep?.reference === "north";
  const reference: ObstacleReference = scanRecent
    ? northSweep && input.yawDeg === null
      ? "north"
      : "forward"
    : (sweep?.reference ?? "forward");
  const rotate = reference === "forward" && northSweep ? -(input.yawDeg ?? 0) : 0;

  const sectorNearestM = sweep?.closestCm != null ? sweep.closestCm / 100 : null;
  const scanNearest = scanRecent ? nearestScanM(scanRecent) : null;
  const displayM =
    input.setting === "auto" ? autoRadarScale(minOf(sectorNearestM, scanNearest)) : input.setting;

  const sectors: RadarSectorView[] = [];
  for (const s of sweep?.sectors ?? []) {
    const m = s.distanceCm / 100;
    if (m > RADAR_CAUTION_M) continue;
    const a = s.startDeg + rotate;
    const b = s.endDeg + rotate;
    const rd = Math.max(inner + 1, Math.min(R, (m / displayM) * R));
    sectors.push({
      wedge: wedgePath(c, a, b, rd, inner),
      arc: m <= displayM ? arcPath(c, a, b, rd) : null,
      tone: m < RADAR_DANGER_M ? "crit" : "warn",
    });
  }

  const scanFresh =
    input.scan && reference === "forward" && within(input.scan.receivedAt, now, SCAN_STALE_MS)
      ? input.scan.data
      : null;
  const dots = scanFresh
    ? radarScanDots(
        scanFresh,
        displayM,
        R,
        c,
        c,
        input.lowPower ? RADAR_MAX_DOTS_LOW_POWER : RADAR_MAX_DOTS,
      )
    : [];

  const nav = input.nav && within(input.nav.receivedAt, now, NAV_STATE_STALE_MS) ? input.nav.data : null;
  const nearestM = stale ? null : minOf(nav?.minObstacleM ?? null, sectorNearestM, scanNearest);

  const rings = [1, 2, 3].map((k) => {
    const r = (R * k) / 3;
    const [lx, ly] = polar(c, 45, r);
    return { r, label: String((displayM * k) / 3), lx, ly };
  });

  return {
    hidden: !input.obstacle && !input.scan,
    stale,
    reference,
    displayM,
    rings,
    sectors,
    dots,
    nearestM,
    band: radarBand(nearestM),
    rateHz: nav?.obstacleRateHz ?? null,
  };
}

/** `+` narrows the range one step, `−` widens it; both pin the scale. */
export function keyRadarScale(displayM: RadarScale, key: "+" | "-"): RadarScale {
  if (key === "+") return displayM === 12 ? 6 : 3;
  return displayM === 3 ? 6 : 12;
}

/** Low-power drawing: the `?layer=minimal` URL flag or the page power hint. */
export function radarLowPower(search: string, powerHint: string | undefined): boolean {
  return new URLSearchParams(search).get("layer") === "minimal" || powerHint === "low";
}
