/**
 * @module TimeSeriesChart
 * @description Reusable inline SVG single-series time-series chart.
 * Supports optional secondary data series.
 * Extracted from QuickGraphs.tsx.
 * @license GPL-3.0-only
 */

// ── Shared types ─────────────────────────────────────────────

export interface ChartPoint {
  t: number;
  v: number;
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
