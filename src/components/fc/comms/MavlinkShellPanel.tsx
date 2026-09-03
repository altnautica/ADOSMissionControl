"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { Terminal, Send, Trash2, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

// ── Constants ────────────────────────────────────────────────

const MAX_LINES = 1000;
const COMMON_COMMANDS = [
  { cmd: "top", desc: "System load" },
  { cmd: "listener sensor_combined", desc: "Sensor data" },
  { cmd: "dmesg", desc: "Kernel messages" },
  { cmd: "param show", desc: "All parameters" },
  { cmd: "param show SYS_AUTOSTART", desc: "Airframe ID" },
  { cmd: "mavlink status", desc: "MAVLink link info" },
  { cmd: "uorb top", desc: "uORB topic rates" },
  { cmd: "perf", desc: "Performance counters" },
];

// ── Component ────────────────────────────────────────────────

export function MavlinkShellPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === 'px4';

  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const protocol = getSelectedProtocol();

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  // Subscribe to serial/shell data from protocol
  useEffect(() => {
    if (!protocol) return;
    setConnected(true);

    const unsub = protocol.onSerialData((data) => {
      // SERIAL_CONTROL responses come as { device, data: Uint8Array }
      const text = new TextDecoder().decode(data.data);
      if (text) {
        setLines(prev => {
          const newLines = [...prev, ...text.split('\n').filter(l => l.length > 0)];
          return newLines.slice(-MAX_LINES);
        });
      }
    });

    return () => {
      unsub();
    };
  }, [protocol]);

  const sendCommand = useCallback((cmd: string) => {
    if (!protocol || !cmd.trim()) return;

    // Add to display
    setLines(prev => [...prev, `nsh> ${cmd}`].slice(-MAX_LINES));

    // Send via SERIAL_CONTROL (device=10=SHELL, flags=RESPOND|EXCLUSIVE)
    // The adapter handles encoding: sendSerialData(text) encodes to
    // SERIAL_CONTROL with device=10, flags=6, and appends newline.
    protocol.sendSerialData(cmd);

    // Update history
    setHistory(prev => [cmd, ...prev.filter(h => h !== cmd)].slice(0, 50));
    setHistoryIdx(-1);
    setInput("");
  }, [protocol]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      sendCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const newIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      } else {
        setHistoryIdx(-1);
        setInput("");
      }
    }
  }

  function clearTerminal() {
    setLines([]);
  }

  function copyOutput() {
    navigator.clipboard.writeText(lines.join('\n'));
    toast("Output copied to clipboard", "success");
  }

  function downloadOutput() {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nsh-output-${new Date().toISOString().slice(0, 19)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-accent-primary" />
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-status-success' : 'bg-status-error'}`} />
          <h2 className="text-sm font-medium text-text-primary">MAVLink Shell</h2>
          <span className="text-[10px] text-text-tertiary">PX4 NuttX Console</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={copyOutput} title="Copy output">
            <Copy size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={downloadOutput} title="Download output">
            <Download size={14} />
          </Button>
          <Button size="sm" variant="ghost" onClick={clearTerminal} title="Clear terminal">
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {/* Quick commands */}
      <div className="flex gap-1 px-4 py-1.5 border-b border-border-default bg-bg-tertiary overflow-x-auto">
        {COMMON_COMMANDS.map(({ cmd, desc }) => (
          <button
            key={cmd}
            onClick={() => sendCommand(cmd)}
            title={desc}
            className="px-2 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-secondary hover:bg-accent-primary/20 hover:text-accent-primary transition-colors whitespace-nowrap"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Terminal output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs bg-bg-primary text-gcs-hud-green"
      >
        {lines.length === 0 && (
          <div className="text-text-tertiary">
            {connected ? "Connected. Type a command or use quick commands above." : "Waiting for connection..."}
          </div>
        )}
        {lines.map((line, i) => (
          <div key={i} className={line.startsWith('nsh>') ? 'text-accent-primary' : ''}>
            {line}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border-default bg-bg-secondary">
        <span className="text-xs text-accent-primary font-mono">nsh&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter NuttX command..."
          className="flex-1 bg-transparent text-xs text-text-primary font-mono outline-none placeholder:text-text-tertiary"
          autoFocus
        />
        <Button size="sm" variant="ghost" onClick={() => sendCommand(input)} disabled={!input.trim()}>
          <Send size={14} />
        </Button>
      </div>
    </div>
  );
}
