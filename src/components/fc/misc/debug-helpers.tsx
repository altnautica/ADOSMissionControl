"use client";

import { downloadBlob } from "@/lib/download";

export interface DebugValue {
  name: string;
  value: number;
  type: "float" | "int" | "debug";
  lastUpdate: number;
}

export interface HistoryPoint {
  t: number;
  v: number;
}

export type ViewMode = "table" | "graph";

export const GRAPH_COLORS = [
  "var(--accent-primary)",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
];

export const MAX_HISTORY = 300;
export const MAX_GRAPH_KEYS = 4;

export function MiniChart({
  data,
  color,
  width = 300,
  height = 64,
}: {
  data: HistoryPoint[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center bg-bg-tertiary/30 rounded" style={{ width, height }}>
        <span className="text-[10px] text-text-tertiary">Waiting for data...</span>
      </div>
    );
  }

  const minV = Math.min(...data.map((d) => d.v));
  const maxV = Math.max(...data.map((d) => d.v));
  const range = maxV - minV || 1;
  const pad = 2;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - pad - ((d.v - minV) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="bg-bg-tertiary/30 rounded">
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--border-default)" strokeWidth="0.5" strokeDasharray="4,4" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
      <text x={2} y={10} fill="var(--text-tertiary)" fontSize="8" fontFamily="monospace">{maxV.toPrecision(4)}</text>
      <text x={2} y={height - 2} fill="var(--text-tertiary)" fontSize="8" fontFamily="monospace">{minV.toPrecision(4)}</text>
    </svg>
  );
}

export function exportCSV(
  values: Map<string, DebugValue>,
  history: Map<string, HistoryPoint[]>,
) {
  const rows = ["timestamp,name,value,type"];
  for (const [name, entries] of history) {
    const info = values.get(name);
    for (const entry of entries) {
      rows.push(
        `${new Date(entry.t).toISOString()},${name},${entry.v},${info?.type ?? "unknown"}`,
      );
    }
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  downloadBlob(blob, `debug-values-${new Date().toISOString().slice(0, 10)}.csv`);
}
