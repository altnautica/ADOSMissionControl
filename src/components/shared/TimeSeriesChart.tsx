/**
 * @module TimeSeriesChart
 * @description Reusable inline SVG time-series chart components.
 * Supports single-series (TimeSeriesChart) and multi-series (MultiSeriesChart)
 * with optional threshold lines, fixed Y ranges, and center lines.
 * Extracted from QuickGraphs.tsx.
 * @license GPL-3.0-only
 */

// ── Types ────────────────────────────────────────────────────

export interface ChartPoint {
  t: number;
  v: number;
}

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

// ── Single-series chart ──────────────────────────────────────

export function TimeSeriesChart({
  data,
  color,
  label,
  unit,
  width = 500,
  height = 100,
  secondaryData,
  secondaryColor,
  secondaryLabel,
  secondaryUnit,
}: {
  data: ChartPoint[];
  color: string;
  label: string;
  unit: string;
  width?: number;
  height?: number;
  secondaryData?: ChartPoint[];
  secondaryColor?: string;
  secondaryLabel?: string;
  secondaryUnit?: string;
}) {
  if (data.length < 2) {
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

  // Primary series
  const minV = Math.min(...data.map((d) => d.v));
  const maxV = Math.max(...data.map((d) => d.v));
  const range = maxV - minV || 1;
  const tMin = data[0].t;
  const tMax = data[data.length - 1].t;
  const tRange = tMax - tMin || 1;

  const points = data
    .map((d) => {
      const x = ((d.t - tMin) / tRange) * (chartW - pad * 2) + pad;
      const y =
        chartH - pad - ((d.v - minV) / range) * (chartH - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  // Secondary series (if provided)
  let secondaryPoints = "";
  let secMin = 0;
  let secMax = 0;
  if (secondaryData && secondaryData.length >= 2) {
    secMin = Math.min(...secondaryData.map((d) => d.v));
    secMax = Math.max(...secondaryData.map((d) => d.v));
    const secRange = secMax - secMin || 1;
    secondaryPoints = secondaryData
      .map((d) => {
        const x = ((d.t - tMin) / tRange) * (chartW - pad * 2) + pad;
        const y =
          chartH - pad - ((d.v - secMin) / secRange) * (chartH - pad * 2);
        return `${x},${y}`;
      })
      .join(" ");
  }

  const latest = data[data.length - 1];
  const secLatest = secondaryData?.[secondaryData.length - 1];
  const duration = (tMax - tMin) / 1000;

  return (
    <div>
      <svg
        width={chartW}
        height={chartH}
        className="bg-bg-tertiary/30 rounded"
      >
        {/* Mid line */}
        <line
          x1="0"
          y1={chartH / 2}
          x2={chartW}
          y2={chartH / 2}
          stroke="var(--border-default)"
          strokeWidth="0.5"
          strokeDasharray="4,4"
        />
        {/* Primary series */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
        />
        {/* Secondary series */}
        {secondaryPoints && secondaryColor && (
          <polyline
            points={secondaryPoints}
            fill="none"
            stroke={secondaryColor}
            strokeWidth="1.5"
            strokeDasharray="3,2"
          />
        )}
        {/* Y axis labels — primary */}
        <text
          x={3}
          y={12}
          fill="var(--text-tertiary)"
          fontSize="8"
          fontFamily="monospace"
        >
          {maxV.toFixed(1)}
          {unit}
        </text>
        <text
          x={3}
          y={chartH - 3}
          fill="var(--text-tertiary)"
          fontSize="8"
          fontFamily="monospace"
        >
          {minV.toFixed(1)}
          {unit}
        </text>
        {/* Y axis labels — secondary (right side) */}
        {secondaryData && secondaryData.length >= 2 && (
          <>
            <text
              x={chartW - 3}
              y={12}
              fill="var(--text-tertiary)"
              fontSize="8"
              fontFamily="monospace"
              textAnchor="end"
            >
              {secMax.toFixed(1)}
              {secondaryUnit}
            </text>
            <text
              x={chartW - 3}
              y={chartH - 3}
              fill="var(--text-tertiary)"
              fontSize="8"
              fontFamily="monospace"
              textAnchor="end"
            >
              {secMin.toFixed(1)}
              {secondaryUnit}
            </text>
          </>
        )}
      </svg>
      <div className="flex items-center justify-between mt-1 text-[9px] font-mono text-text-tertiary">
        <div className="flex items-center gap-3">
          <span style={{ color }}>
            {label}: {latest.v.toFixed(2)}
            {unit}
          </span>
          {secLatest && secondaryColor && secondaryLabel && (
            <span style={{ color: secondaryColor }}>
              {secondaryLabel}: {secLatest.v.toFixed(2)}
              {secondaryUnit}
            </span>
          )}
        </div>
        <span>
          {data.length} pts / {duration.toFixed(1)}s
        </span>
      </div>
    </div>
  );
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
