"use client";

import { useRef, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CalibrationLogEntry, SEVERITY_COLORS } from "./calibration-types";

export function CalibrationLog({
  logEntries,
  onClear,
}: {
  logEntries: CalibrationLogEntry[];
  onClear: () => void;
}) {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const logContainer = logContainerRef.current;
    if (!logContainer) return;

    const distanceFromBottom =
      logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight;
    const shouldStickToBottom = distanceFromBottom <= 24;

    if (shouldStickToBottom) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }, [logEntries]);

  return (
    <div className="xl:sticky xl:top-6 xl:self-start">
      <div className="border border-border-default bg-bg-secondary">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
          <h3 className="text-xs font-medium text-text-primary">Calibration Log</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-5 w-5 p-0"
            title="Clear log"
          >
            <Trash2 size={12} />
          </Button>
        </div>
        <div ref={logContainerRef} className="h-[400px] overflow-y-auto overscroll-contain p-2 font-mono text-[10px] space-y-0.5">
          {logEntries.length === 0 ? (
            <p className="text-text-tertiary italic">No calibration messages yet</p>
          ) : (
            logEntries.map((entry, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-text-tertiary shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className={cn(SEVERITY_COLORS[entry.severity] ?? "text-text-tertiary")}>
                  {entry.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
