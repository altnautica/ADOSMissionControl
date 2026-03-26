/**
 * @module MultiSeriesChart
 * @description Reusable inline SVG multi-series time-series chart.
 * Supports threshold lines, fixed Y ranges, and center lines.
 * Extracted from QuickGraphs.tsx.
 * @license GPL-3.0-only
 */

import type { ChartPoint } from "./TimeSeriesChart";

// ── Types ────────────────────────────────────────────────────

export interface MultiSeries {
  data: ChartPoint[];
  color: string;
  label: string;
}

export interface ThresholdLine {
  value: number;
  color: string;
  label: string;
}

// ── Multi-series chart ───────────────────────────────────────

export function MultiSeriesChart({
  series,
  unit,
  width = 500,
  height = 120,
  thresholds,
  fixedYMin,
  fixedYMax,
  centerLine,
}: {
  series: MultiSeries[];
  unit: string;
  width?: number;
  height?: number;
  thresholds?: ThresholdLine[];
  fixedYMin?: number;
  fixedYMax?: number;
  centerLine?: number;
}) {
  // Find global time range across all series
  const allPoints = series.flatMap((s) => s.data);
  if (allPoints.length < 2) {
    return (
      <div
        className="flex items-center justify-center bg-bg-tertiary/30 rounded"
        style={{ width, height }}
      >
        <span className="text-[10px] text-text-tertiary">
          Waiting for data...
        </span>
      </div>
    );
  }

  const pad = 4;
  const chartW = width;
  const chartH = height;

  const tMin = Math.min(...allPoints.map((d) => d.t));
  const tMax = Math.max(...allPoints.map((d) => d.t));
  const tRange = tMax - tMin || 1;

  // Global Y range (include thresholds in range calculation)
  const allValues = allPoints.map((d) => d.v);
  if (thresholds) {
    for (const th of thresholds) allValues.push(th.value);
  }
  if (centerLine !== undefined) allValues.push(centerLine);
  const minV = fixedYMin ?? Math.min(...allValues);
  const maxV = fixedYMax ?? Math.max(...allValues);
  const range = maxV - minV || 1;

  function toX(t: number) {
    return ((t - tMin) / tRange) * (chartW - pad * 2) + pad;
  }
  function toY(v: number) {
    return chartH - pad - ((v - minV) / range) * (chartH - pad * 2);
  }

  const duration = (tMax - tMin) / 1000;

  return (
    <div>
      <svg
        width={chartW}
        height={chartH}
        className="bg-bg-tertiary/30 rounded"
      >
        {/* Center line */}
        {centerLine !== undefined && (
          <line
            x1={pad}
            y1={toY(centerLine)}
            x2={chartW - pad}
            y2={toY(centerLine)}
            stroke="var(--border-default)"
            strokeWidth="0.5"
            strokeDasharray="4,4"
          />
        )}
        {/* Threshold lines */}
        {thresholds?.map((th) => (
          <g key={th.label}>
            <line
              x1={pad}
              y1={toY(th.value)}
              x2={chartW - pad}
              y2={toY(th.value)}
              stroke={th.color}
              strokeWidth="0.5"
              strokeDasharray="6,3"
              opacity={0.6}
            />
            <text
              x={chartW - pad - 2}
              y={toY(th.value) - 2}
              fill={th.color}
              fontSize="7"
              fontFamily="monospace"
              textAnchor="end"
              opacity={0.7}
            >
              {th.label}
            </text>
          </g>
        ))}
        {/* Data series */}
        {series.map((s) => {
          if (s.data.length < 2) return null;
          const pts = s.data
            .map((d) => `${toX(d.t)},${toY(d.v)}`)
            .join(" ");
          return (
            <polyline
              key={s.label}
              points={pts}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
            />
          );
        })}
        {/* Y axis labels */}
        <text x={3} y={12} fill="var(--text-tertiary)" fontSize="8" fontFamily="monospace">
          {maxV.toFixed(0)}{unit}
        </text>
        <text x={3} y={chartH - 3} fill="var(--text-tertiary)" fontSize="8" fontFamily="monospace">
          {minV.toFixed(0)}{unit}
        </text>
      </svg>
      <div className="flex items-center justify-between mt-1 text-[9px] font-mono text-text-tertiary">
        <div className="flex items-center gap-3">
          {series.map((s) => {
            const latest = s.data[s.data.length - 1];
            return (
              <span key={s.label} style={{ color: s.color }}>
                {s.label}: {latest?.v.toFixed(1) ?? "--"}{unit}
              </span>
            );
          })}
        </div>
        <span>
          {allPoints.length} pts / {duration.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
