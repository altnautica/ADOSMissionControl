"use client";

/**
 * @module ProximityRadar
 * @description SVG polar radar showing OBSTACLE_DISTANCE data from the flight controller.
 * Renders 72 arc sectors (5 degrees each) color-coded by distance.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";

const RADAR_SIZE = 120;
const CENTER = RADAR_SIZE / 2;
const OUTER_R = 52;
const INNER_R = 14;
const INVALID_DISTANCE = 65535;

/** Distance thresholds in centimeters */
const DANGER_CM = 200;   // <2m = red
const CAUTION_CM = 500;  // 2-5m = yellow

function sectorColor(distCm: number): string | null {
  if (distCm >= INVALID_DISTANCE) return null; // no reading
  if (distCm > CAUTION_CM) return null;        // safe, don't clutter
  if (distCm < DANGER_CM) return "rgba(239, 68, 68, 0.6)";  // red
  return "rgba(223, 241, 64, 0.3)";                          // yellow/lime
}

function polarToCart(angleDeg: number, r: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // 0 deg = up (north)
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

function arcPath(startDeg: number, endDeg: number, outerR: number, innerR: number): string {
  const [ox1, oy1] = polarToCart(startDeg, outerR);
  const [ox2, oy2] = polarToCart(endDeg, outerR);
  const [ix2, iy2] = polarToCart(endDeg, innerR);
  const [ix1, iy1] = polarToCart(startDeg, innerR);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${ox1} ${oy1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1}`,
    `Z`,
  ].join(" ");
}

export function ProximityRadar() {
  const version = useTelemetryStore((s) => s._version);
  const obstacleBuffer = useTelemetryStore((s) => s.obstacle);

  const latest = obstacleBuffer.latest();

  const { sectors, closestM } = useMemo(() => {
    if (!latest || !latest.distances || latest.distances.length === 0) {
      return { sectors: null, closestM: null };
    }

    const increment = latest.increment || 5;
    const sectorCount = Math.min(latest.distances.length, Math.floor(360 / increment));
    const angleOffset = latest.angleOffset || 0;

    const paths: Array<{ d: string; fill: string }> = [];
    let closest = INVALID_DISTANCE;

    for (let i = 0; i < sectorCount; i++) {
      const dist = latest.distances[i];
      if (dist < closest) closest = dist;

      const fill = sectorColor(dist);
      if (!fill) continue;

      // Scale radius by distance (closer = larger arc toward center)
      const startAngle = angleOffset + i * increment;
      const endAngle = startAngle + increment;
      paths.push({ d: arcPath(startAngle, endAngle, OUTER_R, INNER_R), fill });
    }

    return {
      sectors: paths.length > 0 ? paths : null,
      closestM: closest < INVALID_DISTANCE ? (closest / 100).toFixed(1) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, version]);

  // Don't render if no obstacle data
  if (!sectors) return null;

  return (
    <div className="absolute bottom-14 right-3 z-10" title="Proximity Radar">
      <svg
        width={RADAR_SIZE}
        height={RADAR_SIZE}
        viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
        className="drop-shadow-lg"
      >
        {/* Background circle */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={OUTER_R + 2}
          fill="rgba(10, 10, 15, 0.75)"
          stroke="rgba(58, 58, 74, 0.5)"
          strokeWidth={1}
        />

        {/* Cardinal lines */}
        {[0, 90, 180, 270].map((angle) => {
          const [x, y] = polarToCart(angle, OUTER_R);
          return (
            <line
              key={angle}
              x1={CENTER}
              y1={CENTER}
              x2={x}
              y2={y}
              stroke="rgba(58, 58, 74, 0.3)"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Range rings */}
        {[INNER_R, (INNER_R + OUTER_R) / 2, OUTER_R].map((r) => (
          <circle
            key={r}
            cx={CENTER}
            cy={CENTER}
            r={r}
            fill="none"
            stroke="rgba(58, 58, 74, 0.2)"
            strokeWidth={0.5}
          />
        ))}

        {/* Obstacle sectors */}
        {sectors.map((s, i) => (
          <path key={i} d={s.d} fill={s.fill} />
        ))}

        {/* Drone icon (center dot) */}
        <circle cx={CENTER} cy={CENTER} r={3} fill="#3A82FF" />

        {/* North indicator */}
        <text
          x={CENTER}
          y={CENTER - OUTER_R - 4}
          textAnchor="middle"
          fontSize={7}
          fill="rgba(232, 232, 237, 0.5)"
          fontFamily="monospace"
        >
          N
        </text>

        {/* Closest distance label */}
        {closestM && (
          <text
            x={CENTER}
            y={CENTER + 5}
            textAnchor="middle"
            fontSize={10}
            fontWeight="bold"
            fill={parseFloat(closestM) < 2 ? "#EF4444" : "#DFF140"}
            fontFamily="monospace"
          >
            {closestM}m
          </text>
        )}
      </svg>
    </div>
  );
}
