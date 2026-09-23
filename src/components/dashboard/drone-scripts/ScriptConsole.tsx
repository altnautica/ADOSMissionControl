"use client";

/**
 * @module drone-scripts/ScriptConsole
 * @description The output console for the ArduPilot Scripts tab. ArduPilot Lua
 * scripts print via `gcs:send_text()`, which arrives as MAVLink STATUSTEXT, so
 * this subscribes to the selected drone's status stream and keeps a taller ring
 * than the Overview tile. A "scripts only" toggle applies a heuristic filter
 * (scripting runtime + common script markers) — off by default, since prearm
 * and mode messages are useful context while testing a script (the
 * filter is labeled heuristic, not claimed exact).
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { useDroneManager } from "@/stores/drone-manager";

const MAX_LINES = 40;

/** Heuristic markers for lines a Lua script (or the scripting runtime) emits. */
const SCRIPT_MARKER = /lua|script|\.lua|out of memory|heap|instruction count/i;

interface Line {
  id: number;
  severity: number;
  text: string;
}

function severityLevel(sev: number): StatusLevel {
  if (sev <= 2) return "critical";
  if (sev === 3) return "serious";
  if (sev === 4) return "warning";
  return "idle";
}

export function ScriptConsole() {
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const [lines, setLines] = useState<Line[]>([]);
  const [scriptsOnly, setScriptsOnly] = useState(false);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines([]);
    const protocol = getProtocol();
    if (!protocol) return;
    const unsub = protocol.onStatusText((data) => {
      setLines((prev) => {
        const next = [
          ...prev,
          { id: idRef.current++, severity: data.severity, text: data.text },
        ];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });
    return unsub;
  }, [getProtocol, selectedId]);

  const shown = useMemo(
    () => (scriptsOnly ? lines.filter((l) => SCRIPT_MARKER.test(l.text)) : lines),
    [lines, scriptsOnly],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className="flex h-64 flex-col rounded-lg border border-border-default bg-bg-secondary p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">
            Script Output
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-text-tertiary cursor-pointer">
            <input
              type="checkbox"
              checked={scriptsOnly}
              onChange={(e) => setScriptsOnly(e.target.checked)}
              className="w-3 h-3 accent-accent-primary"
            />
            Scripts only
          </label>
          <button
            type="button"
            title="Clear"
            onClick={() => setLines([])}
            className="p-0.5 text-text-tertiary hover:text-accent-primary cursor-pointer"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="flex h-full items-center justify-center text-[11px] text-text-tertiary">
            {scriptsOnly
              ? "No script output yet."
              : "No messages yet. Script output (gcs:send_text) appears here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {shown.map((line) => (
              <li key={line.id} className="flex items-start gap-1.5">
                <StatusDot
                  status={severityLevel(line.severity)}
                  size="xs"
                  className="mt-1 flex-shrink-0"
                />
                <span className="break-words font-mono text-[11px] leading-tight text-text-secondary">
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
