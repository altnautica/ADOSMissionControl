"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback, useEffect, useRef } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { Button } from "@/components/ui/button";
import { Trash2, Terminal, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";

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

export function CliPanel() {
  const t = useTranslations("telemetryStrip");
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { firmwareType } = useFirmwareCapabilities();
  const isBetaflight = firmwareType === 'betaflight';
  const connected = !!getSelectedProtocol();

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const serialUnsubRef = useRef<(() => void) | null>(null);

  // Subscribe to STATUSTEXT messages
  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;

    unsubRef.current?.();
    unsubRef.current = protocol.onStatusText(({ severity, text }) => {
      setEntries((prev) => [
        ...prev,
        { id: nextId++, timestamp: Date.now(), severity, text },
      ]);
    });

    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [getSelectedProtocol]);

  // Subscribe to SERIAL_CONTROL responses
  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;

    serialUnsubRef.current?.();
    serialUnsubRef.current = protocol.onSerialData(({ data }) => {
      const text = new TextDecoder().decode(data).replace(/\0/g, "");
      if (text.length === 0) return;
      setEntries((prev) => [
        ...prev,
        { id: nextId++, timestamp: Date.now(), severity: 6, text },
      ]);
    });

    return () => {
      serialUnsubRef.current?.();
      serialUnsubRef.current = null;
    };
  }, [getSelectedProtocol]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  const clearLog = useCallback(() => {
    setEntries([]);
  }, []);

  const exportLog = useCallback(() => {
    const lines = entries.map((e) => {
      const time = formatTs(e.timestamp);
      const sev = SEVERITY_LABELS[e.severity] ?? "???";
      return `[${time}] [${sev}] ${e.text}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fc-console-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = command.trim();
      if (!trimmed) return;

      // Add to history
      setHistory((prev) => [...prev, trimmed]);
      setHistoryIdx(-1);

      // Local echo
      setEntries((prev) => [
        ...prev,
        { id: nextId++, timestamp: Date.now(), severity: 6, text: `> ${trimmed}` },
      ]);

      // Send via SERIAL_CONTROL passthrough
      const protocol = getSelectedProtocol();
      if (protocol) {
        protocol.sendSerialData(trimmed);
      }

      setCommand("");
    },
    [command, getSelectedProtocol],
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
          <Button variant="ghost" size="sm" icon={<Download size={12} />} onClick={exportLog} disabled={entries.length === 0}>
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
        className="flex-1 bg-[#0a0a0f] border border-border-default overflow-y-auto p-3 font-mono text-xs"
      >
        {entries.length === 0 && (
          <div className="text-text-tertiary">
            <p>ADOS Mission Control — FC Console</p>
            <p className="mt-1">
              {connected
                ? isBetaflight
                  ? "Betaflight CLI active. Type `help` for available commands. Type `exit` to leave CLI mode."
                  : "Listening for STATUSTEXT messages from flight controller..."
                : "Connect a drone to receive FC messages."}
            </p>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={cn("flex gap-2 leading-5", entry.severity <= 3 && "bg-status-error/5")}>
            <span className="text-text-tertiary shrink-0">{formatTs(entry.timestamp)}</span>
            <span
              className={cn("shrink-0 w-14 text-right", severityColor(entry.severity))}
            >
              [{SEVERITY_LABELS[entry.severity] ?? "???"}]
            </span>
            <span className={severityColor(entry.severity)}>{entry.text}</span>
          </div>
        ))}
      </div>

      {/* Command input */}
      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <div className="flex-1 flex items-center bg-[#0a0a0f] border border-border-default px-2">
          <span className="text-[#DFF140] font-mono text-xs mr-1">&gt;</span>
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
            className="flex-1 bg-transparent h-8 text-[#DFF140] font-mono text-xs placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
        <Button variant="secondary" size="md" type="submit" disabled={!connected}>
          Send
        </Button>
      </form>
    </div>
  );
}
