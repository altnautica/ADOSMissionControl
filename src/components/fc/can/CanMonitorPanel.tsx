"use client";

/**
 * @module CanMonitorPanel
 * @description Read-only CAN bus traffic monitor. Shows raw CAN frames passing
 * through the flight controller's CAN passthrough (MAVLink CAN_FRAME message 386).
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { Activity, Power, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanMonitorStore } from "@/stores/can-monitor-store";

/** Format a number as hex with the given digit width. */
function hex(n: number, digits: number): string {
  return n.toString(16).toUpperCase().padStart(digits, "0");
}

/** Format CAN data bytes as space-separated hex. */
function formatData(data: Uint8Array, len: number): string {
  const visible = Math.min(len, data.byteLength);
  const parts: string[] = [];
  for (let i = 0; i < visible; i++) {
    parts.push(hex(data[i], 2));
  }
  return parts.join(" ");
}

export function CanMonitorPanel() {
  // Subscribe to version so the UI re-renders on each frame
  const version = useCanMonitorStore((s) => s._version);
  const enabled = useCanMonitorStore((s) => s.enabled);
  const setEnabled = useCanMonitorStore((s) => s.setEnabled);
  const clear = useCanMonitorStore((s) => s.clear);
  const totalFrames = useCanMonitorStore((s) => s.totalFrames);
  const fps = useCanMonitorStore((s) => s.framesPerSecond);
  const framesBuffer = useCanMonitorStore((s) => s.frames);
  const idCounts = useCanMonitorStore((s) => s.idCounts);

  // Get last 50 frames for display
  const recentFrames = useMemo(() => {
    return framesBuffer.last(50).reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framesBuffer, version]);

  // Top 5 most active CAN IDs
  const topIds = useMemo(() => {
    const entries = Array.from(idCounts.entries());
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idCounts, version]);

  return (
    <div className="p-4 max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">CAN Bus Monitor</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={clear}
            disabled={!enabled || totalFrames === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-status-error hover:text-status-error text-text-secondary transition-colors disabled:opacity-30"
            title="Clear frames"
          >
            <Trash2 size={12} />
            Clear
          </button>
          <button
            onClick={() => setEnabled(!enabled)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors",
              enabled
                ? "bg-status-success/20 text-status-success hover:bg-status-success/30"
                : "bg-bg-tertiary text-text-secondary hover:bg-bg-secondary",
            )}
          >
            <Power size={12} />
            {enabled ? "Capturing" : "Start"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
          <div className="flex items-center gap-1.5 text-text-tertiary mb-1">
            <Activity size={11} />
            <span className="text-[10px] uppercase tracking-wider font-medium">Total Frames</span>
          </div>
          <p className="text-lg font-mono font-semibold text-text-primary">{totalFrames.toLocaleString()}</p>
        </div>
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
          <div className="flex items-center gap-1.5 text-text-tertiary mb-1">
            <Activity size={11} />
            <span className="text-[10px] uppercase tracking-wider font-medium">Frames/sec</span>
          </div>
          <p className="text-lg font-mono font-semibold text-text-primary">{fps}</p>
        </div>
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
          <div className="flex items-center gap-1.5 text-text-tertiary mb-1">
            <Activity size={11} />
            <span className="text-[10px] uppercase tracking-wider font-medium">Distinct IDs</span>
          </div>
          <p className="text-lg font-mono font-semibold text-text-primary">{idCounts.size}</p>
        </div>
      </div>

      {/* Top IDs */}
      {topIds.length > 0 && (
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">
            Most Active CAN IDs
          </h3>
          <div className="space-y-1">
            {topIds.map(([id, count]) => (
              <div key={id} className="flex items-center justify-between text-xs font-mono">
                <span className="text-text-primary">0x{hex(id, 8)}</span>
                <span className="text-text-tertiary">{count} frames</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Frames table */}
      <div className="border border-border-default rounded-lg bg-bg-secondary overflow-hidden">
        <div className="px-3 py-2 border-b border-border-default">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Recent Frames {recentFrames.length > 0 && `(${recentFrames.length})`}
          </h3>
        </div>
        {!enabled ? (
          <div className="text-center py-12">
            <p className="text-xs text-text-tertiary">Click Start to begin capturing CAN frames</p>
          </div>
        ) : recentFrames.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xs text-text-tertiary">Waiting for CAN frames...</p>
            <p className="text-[10px] text-text-tertiary mt-1">
              Requires a flight controller with CAN passthrough enabled (CAN_P1_DRIVER, CAN_D1_PROTOCOL = MAVLink)
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-secondary">
                <tr className="border-b border-border-default text-text-tertiary">
                  <th className="text-left py-1.5 px-3 font-medium">Time</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Bus</th>
                  <th className="text-left py-1.5 pr-3 font-medium">CAN ID</th>
                  <th className="text-left py-1.5 pr-3 font-medium">DLC</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {recentFrames.map((frame, i) => {
                  const time = new Date(frame.timestamp).toLocaleTimeString("en-IN", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });
                  const ms = String(frame.timestamp % 1000).padStart(3, "0");
                  return (
                    <tr key={`${frame.timestamp}-${i}`} className="border-b border-border-default last:border-b-0 hover:bg-bg-primary/40">
                      <td className="py-1 px-3 font-mono text-text-tertiary text-[10px]">
                        {time}.{ms}
                      </td>
                      <td className="py-1 pr-3 font-mono text-text-secondary">
                        {frame.bus}
                      </td>
                      <td className="py-1 pr-3 font-mono text-accent-primary">
                        0x{hex(frame.id, 8)}
                      </td>
                      <td className="py-1 pr-3 font-mono text-text-secondary">
                        {frame.len}
                      </td>
                      <td className="py-1 pr-3 font-mono text-text-secondary">
                        {formatData(frame.data, frame.len)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
