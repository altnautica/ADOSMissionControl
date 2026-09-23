"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDroneManager } from "@/stores/drone-manager";
import { Button } from "@/components/ui/button";
import { Trash2, Terminal, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { RingBuffer } from "@/lib/ring-buffer";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { downloadBlob } from "@/lib/download";

interface LogEntry {
  id: number;
  timestamp: number;
  severity: number;
  text: string;
}

const SEVERITY_LABELS: Record<number, string> = {
  0: "EMERG",
  1: "ALERT",
  2: "CRIT",
  3: "ERROR",
  4: "WARN",
  5: "NOTICE",
  6: "INFO",
  7: "DEBUG",
};

function severityColor(severity: number): string {
  if (severity <= 1) return "text-status-error";
  if (severity <= 3) return "text-status-warning";
  if (severity === 4) return "text-text-primary";
  return "text-text-tertiary";
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

let nextId = 0;

/** Rows kept in the console; older rows are dropped so a long session or a `dump` cannot grow without bound. */
const MAX_ENTRIES = 5000;
const ROW_ESTIMATE_PX = 20;

const IDLE_HINTS: Record<string, string> = {
  betaflight:
    "Betaflight CLI. The first command enters CLI mode and pauses telemetry. `save` writes EEPROM and `exit` leaves CLI mode; neither reboots the flight controller.",
  inav:
    "iNav CLI. The first command enters CLI mode and pauses telemetry. `save` writes EEPROM and `exit` leaves CLI mode; iNav reboots the flight controller for both.",
};

export function CliPanel() {
  const t = useTranslations("telemetryStrip");
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { firmwareType } = useFirmwareCapabilities();
  const connected = !!getSelectedProtocol();

  // Rows live in a ring mutated in place; `version` re-renders at most once a frame.
  const [ring] = useState(() => new RingBuffer<LogEntry>(MAX_ENTRIES));
  const [version, setVersion] = useState(0);
  const frameRef = useRef<number | null>(null);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const scrollRef = useRef<HTMLDivElement>(null);

  const append = useCallback(
    (severity: number, text: string) => {
      ring.push({ id: nextId++, timestamp: Date.now(), severity, text });
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setVersion((v) => v + 1);
      });
    },
    [ring],
  );

  useEffect(() => () => cancelAnimationFrame(frameRef.current ?? 0), []);

  // Subscribe to STATUSTEXT messages
  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    return protocol.onStatusText(({ severity, text }) => append(severity, text));
  }, [getSelectedProtocol, append]);

  // Subscribe to CLI / SERIAL_CONTROL responses
  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    return protocol.onSerialData(({ data }) => {
      const text = new TextDecoder().decode(data).replace(/[\0\r]/g, "");
      if (text.length > 0) append(6, text);
    });
  }, [getSelectedProtocol, append]);

  const count = ring.length;
  const virt = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 20,
  });

  // Keep the newest row in view.
  useEffect(() => {
    if (count > 0) virt.scrollToIndex(count - 1, { align: "end" });
  }, [version, count, virt]);

  const clearLog = useCallback(() => {
    ring.clear();
    setVersion((v) => v + 1);
  }, [ring]);

  const exportLog = useCallback(() => {
    const lines = ring.toArray().map((e) => {
      const time = formatTs(e.timestamp);
      const sev = SEVERITY_LABELS[e.severity] ?? "???";
      return `[${time}] [${sev}] ${e.text}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    downloadBlob(blob, `fc-console-${Date.now()}.txt`);
  }, [ring]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = command.trim();
      if (!trimmed) return;

      // Add to history
      setHistory((prev) => [...prev, trimmed]);
      setHistoryIdx(-1);

      // Local echo
      append(6, `> ${trimmed}`);

      // The protocol turns the line into the firmware's CLI or shell form.
      getSelectedProtocol()?.sendSerialData(trimmed);

      setCommand("");
    },
    [command, getSelectedProtocol, append],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (history.length === 0) return;
        const newIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(newIdx);
        setCommand(history[newIdx]);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIdx < 0) return;
        const newIdx = historyIdx + 1;
        if (newIdx >= history.length) {
          setHistoryIdx(-1);
          setCommand("");
        } else {
          setHistoryIdx(newIdx);
          setCommand(history[newIdx]);
        }
      }
    },
    [history, historyIdx],
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-accent-primary" />
          <h1 className="text-lg font-display font-semibold text-text-primary">FC Console</h1>
          <span
            className={cn(
              "text-[10px] font-mono px-1.5 py-0.5",
              connected ? "bg-status-success/20 text-status-success" : "bg-bg-tertiary text-text-tertiary",
            )}
          >
            {connected ? t("connected") : t("disconnected")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" icon={<Download size={12} />} onClick={exportLog} disabled={count === 0}>
            Export
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={clearLog}>
            Clear
          </Button>
        </div>
      </div>

      {/* Terminal display */}
      <div
        ref={scrollRef}
        className="flex-1 bg-bg-primary border border-border-default overflow-y-auto p-3 font-mono text-xs"
      >
        {count === 0 && (
          <div className="text-text-tertiary">
            <p>ADOS Mission Control — FC Console</p>
            <p className="mt-1">
              {connected
                ? ((firmwareType && IDLE_HINTS[firmwareType]) || "Listening for STATUSTEXT messages from flight controller...")
                : "Connect a drone to receive FC messages."}
            </p>
          </div>
        )}
        <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
          {virt.getVirtualItems().map((row) => {
            const entry = ring.get(row.index);
            if (!entry) return null;
            return (
              <div
                key={entry.id}
                data-index={row.index}
                ref={virt.measureElement}
                className={cn(
                  "absolute left-0 top-0 w-full flex gap-2 leading-5",
                  entry.severity <= 3 && "bg-status-error/5",
                )}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <span className="text-text-tertiary shrink-0">{formatTs(entry.timestamp)}</span>
                <span className={cn("shrink-0 w-14 text-right", severityColor(entry.severity))}>
                  [{SEVERITY_LABELS[entry.severity] ?? "???"}]
                </span>
                <span className={cn("whitespace-pre-wrap break-all", severityColor(entry.severity))}>{entry.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Command input */}
      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <div className="flex-1 flex items-center bg-bg-primary border border-border-default px-2">
          <span className="text-accent-primary font-mono text-xs mr-1">&gt;</span>
          <input
            type="text"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              setHistoryIdx(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Type a command..." : "Connect a drone first"}
            disabled={!connected}
            className="flex-1 bg-transparent h-8 text-accent-primary font-mono text-xs placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
        <Button variant="secondary" size="md" type="submit" disabled={!connected}>
          Send
        </Button>
      </form>
    </div>
  );
}
