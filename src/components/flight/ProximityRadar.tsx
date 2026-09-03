"use client";

/**
 * @module ProximityRadar
 * @description Proximity radar — a faithful port of the reference artifact's
 * `.zone.br .radar` (rings + cardinal lines + N + a nearest-range label) with
 * live OBSTACLE_DISTANCE sectors painted over it (amber caution / red danger).
 * The frame is always shown when the sensor has data; hidden when there is no
 * proximity sensor (an empty ring would falsely read as "all clear").
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly } from "@/lib/telemetry/freshness";

const CENTER = 60;
const OUTER_R = 52;
const INNER_R = 16;
const INVALID_DISTANCE = 65535;
const DANGER_CM = 200; // <2m = red
const CAUTION_CM = 500; // 2-5m = amber

function sectorColor(distCm: number): { fill: string; stroke: string } | null {
  if (distCm >= INVALID_DISTANCE) return null;
  if (distCm > CAUTION_CM) return null;
  if (distCm < DANGER_CM) return { fill: "rgba(255,90,82,.30)", stroke: "var(--crit)" };
  return { fill: "rgba(245,181,68,.28)", stroke: "var(--warn)" };
}

function polarToCart(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

function arcPath(startDeg: number, endDeg: number): string {
  const [ox1, oy1] = polarToCart(startDeg, OUTER_R);
  const [ox2, oy2] = polarToCart(endDeg, OUTER_R);
  const [ix2, iy2] = polarToCart(endDeg, INNER_R);
  const [ix1, iy1] = polarToCart(startDeg, INNER_R);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${ox1} ${oy1}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${INNER_R} ${INNER_R} 0 ${large} 0 ${ix1} ${iy1}`,
    `Z`,
  ].join(" ");
}

export function ProximityRadar() {
  // The ring keeps its last OBSTACLE_DISTANCE forever, so reading `latest()`
  // raw left the radar painting red DANGER arcs from a dead link — the one
  // reading an operator must never see fabricated. Both subscriptions are
  // load-bearing: `_version` says new data arrived, and the clock tick says
  // time passed, which is the only signal that arrives after a link loss.
  useTelemetryStore((s) => s._version);
  useClockTick();
  const obstacleBuffer = useTelemetryStore.getState().obstacle;
  const latest = freshOnly(obstacleBuffer.latest(), Date.now());

  const { hasData, sectors, closestM } = useMemo(() => {
    if (!latest || !latest.distances || latest.distances.length === 0) {
      return { hasData: false, sectors: [] as { d: string; fill: string; stroke: string }[], closestM: null as string | null };
    }
    const inc = latest.increment || 5;
    const count = Math.min(latest.distances.length, Math.floor(360 / inc));
    const off = latest.angleOffset || 0;
    const paths: { d: string; fill: string; stroke: string }[] = [];
    let closest = INVALID_DISTANCE;
    for (let i = 0; i < count; i++) {
      const dist = latest.distances[i];
      if (dist < closest) closest = dist;
      const c = sectorColor(dist);
      if (!c) continue;
      const s = off + i * inc;
      paths.push({ d: arcPath(s, s + inc), fill: c.fill, stroke: c.stroke });
    }
    return {
      hasData: true,
      sectors: paths,
      closestM: closest < INVALID_DISTANCE ? (closest / 100).toFixed(1) : null,
    };
    // `latest` is the whole dependency: it is a stable object reference while
    // the sample stands, and becomes `undefined` the moment it goes stale, so
    // the memo recomputes exactly when the answer changes. The version and
    // clock subscriptions above are what re-run this component; they are not
    // inputs to the arc geometry.
  }, [latest]);

  if (!hasData) return null;

  const nearest = closestM ? parseFloat(closestM) : null;
  const labelColor = nearest === null ? "var(--good)" : nearest < 2 ? "var(--crit)" : "var(--warn)";

  // No positioning wrapper: the cockpit zone container places this. It used to
  // carry `zone br d-std`, anchoring it to the same bottom-right coordinates
  // as the arrangeable-widget container at the same z-index.
  return (
    <div className="radar panel">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <g fill="none" stroke="var(--hair)">
          <circle cx={CENTER} cy={CENTER} r={52} />
          <circle cx={CENTER} cy={CENTER} r={34} />
          <circle cx={CENTER} cy={CENTER} r={16} />
        </g>
        <g stroke="var(--hair-2)">
          <line x1={CENTER} y1={8} x2={CENTER} y2={112} />
          <line x1={8} y1={CENTER} x2={112} y2={CENTER} />
        </g>
        {sectors.map((s, i) => (
          <path key={i} d={s.d} fill={s.fill} stroke={s.stroke} strokeWidth={1} />
        ))}
        <circle cx={CENTER} cy={CENTER} r={3} fill="var(--hud)" />
        <text x={CENTER} y={18} fill="var(--muted)" fontSize={8} textAnchor="middle" fontFamily="var(--mono)">
          N
        </text>
      </svg>
      <div className="rlabel lbl" style={{ color: labelColor }}>
        {closestM ? `nearest ${closestM} m` : "clear"}
      </div>
    </div>
  );
}
