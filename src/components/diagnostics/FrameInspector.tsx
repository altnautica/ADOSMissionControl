"use client";

import { useMemo } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { Binary } from "lucide-react";

/** Show last 50 raw MAVLink frames as hex dump with timestamp + msg ID + name */
export function FrameInspector() {
  // Subscribe to the version counter: the RingBuffer is mutated in place, so
  // subscribing to `messageLog` (a stable reference) would never re-render on
  // new frames, and keying the memo on it never recomputes. Memoize the
  // toArray() allocation on `_version` per the RingBuffer gotcha.
  const version = useDiagnosticsStore((s) => s._version);

  const frames = useMemo(() => {
    return useDiagnosticsStore
      .getState()
      .messageLog.toArray()
      .filter((m) => m.rawHex)
      .slice(-50)
      .reverse();
  }, [version]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Binary size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">Frame Inspector</span>
        <span className="text-[10px] text-text-tertiary font-mono">
          {frames.length} frame{frames.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {frames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
            <Binary size={24} className="text-text-tertiary" />
            <span className="text-xs text-text-tertiary">No frames captured</span>
            <span className="text-[10px] text-text-tertiary">
              Raw MAVLink frame hex dump will appear here
            </span>
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {frames.map((frame, idx) => {
              const time = new Date(frame.timestamp);
              const timeStr = time.toLocaleTimeString("en-US", { hour12: false }) +
                "." + String(time.getMilliseconds()).padStart(3, "0");
              return (
                <div key={`${frame.timestamp}-${idx}`} className="px-4 py-1.5 hover:bg-bg-tertiary/30">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[9px] text-text-tertiary font-mono tabular-nums">{timeStr}</span>
                    <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                      frame.direction === "in"
                        ? "bg-status-success/15 text-status-success"
                        : "bg-accent-primary/15 text-accent-primary"
                    }`}>
                      {frame.direction === "in" ? "RX" : "TX"}
                    </span>
                    <span className="text-[10px] text-accent-primary font-mono">{frame.msgName}</span>
                    <span className="text-[9px] text-text-tertiary font-mono">ID {frame.msgId}</span>
                    <span className="text-[9px] text-text-tertiary font-mono">{frame.size}B</span>
                  </div>
                  <div className="font-mono text-[9px] text-text-secondary break-all leading-relaxed">
                    {frame.rawHex}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
