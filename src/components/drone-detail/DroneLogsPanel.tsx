"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import {
  Download,
  Trash2,
  Pause,
  Play,
  Activity,
  Gauge,
  Battery,
  Signal,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import { Select } from "@/components/ui/select";

// ── Types ────────────────────────────────────────────────────

interface LogMessage {
  id: number;
  timestamp: number;
  severity: number;
  text: string;
}

interface DroneLogsPanelProps {
  droneId: string;
}

type SortField = "timestamp" | "severity" | "text";
type SortDir = "asc" | "desc";

// ── Severity mapping ─────────────────────────────────────────

const SEVERITY_LABELS = [
  "EMERGENCY",
  "ALERT",
  "CRITICAL",
  "ERROR",
  "WARNING",
  "NOTICE",
  "INFO",
  "DEBUG",
] as const;

const SEVERITY_COLORS: Record<number, string> = {
  0: "text-red-500",
  1: "text-red-500",
  2: "text-red-400",
  3: "text-red-400",
  4: "text-yellow-400",
  5: "text-blue-400",
  6: "text-green-400",
  7: "text-text-tertiary",
};

const SEVERITY_BG: Record<number, string> = {
  0: "bg-red-500/10",
  1: "bg-red-500/10",
  2: "bg-red-400/10",
  3: "bg-red-400/10",
  4: "bg-yellow-400/10",
  5: "bg-blue-400/10",
  6: "bg-green-400/10",
  7: "bg-transparent",
};

const MAX_LOG_MESSAGES = 1000;

// ── Message type categories for filtering ────────────────────

const MESSAGE_CATEGORIES = [
  { value: "all", label: "All Messages" },
  { value: "error", label: "Errors (0-3)" },
  { value: "warning", label: "Warnings (4)" },
  { value: "info", label: "Info (5-7)" },
  { value: "arm", label: "Arm/Disarm" },
  { value: "mode", label: "Mode Changes" },
  { value: "gps", label: "GPS" },
  { value: "battery", label: "Battery" },
  { value: "failsafe", label: "Failsafe" },
  { value: "ekf", label: "EKF" },
  { value: "calibration", label: "Calibration" },
] as const;

type CategoryFilter = (typeof MESSAGE_CATEGORIES)[number]["value"];

/** Checks if a message matches the selected category filter. */
function matchesCategory(msg: LogMessage, category: CategoryFilter): boolean {
  if (category === "all") return true;
  if (category === "error") return msg.severity <= 3;
  if (category === "warning") return msg.severity === 4;
  if (category === "info") return msg.severity >= 5;

  const lower = msg.text.toLowerCase();
  switch (category) {
    case "arm": return lower.includes("arm") || lower.includes("disarm");
    case "mode": return lower.includes("mode") || lower.includes("flight mode");
    case "gps": return lower.includes("gps") || lower.includes("sat");
    case "battery": return lower.includes("batt") || lower.includes("voltage") || lower.includes("power");
    case "failsafe": return lower.includes("failsafe") || lower.includes("fs_") || lower.includes("fail");
    case "ekf": return lower.includes("ekf") || lower.includes("ahrs") || lower.includes("imu");
    case "calibration": return lower.includes("cal") || lower.includes("compass") || lower.includes("accel");
    default: return true;
  }
}

// ── Graph channel config ─────────────────────────────────────

const GRAPH_CHANNELS = [
  { key: "altitude" as const, label: "Alt", icon: Activity, color: "#3A82FF" },
  { key: "speed" as const, label: "Spd", icon: Gauge, color: "#DFF140" },
  { key: "battery" as const, label: "Bat", icon: Battery, color: "#22c55e" },
  { key: "rssi" as const, label: "RSSI", icon: Signal, color: "#f97316" },
] as const;

type ChannelKey = (typeof GRAPH_CHANNELS)[number]["key"];

// ── Highlight helper ─────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-accent-primary/30 text-text-primary rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── Sort icon component ──────────────────────────────────────

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronDown size={10} className="text-text-tertiary/30" />;
  return sortDir === "asc"
    ? <ChevronUp size={10} className="text-accent-primary" />
    : <ChevronDown size={10} className="text-accent-primary" />;
}

// ── Component ────────────────────────────────────────────────

export function DroneLogsPanel({ droneId }: DroneLogsPanelProps) {
  const t = useTranslations("logs");
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);

  // Status message log
  const [messages, setMessages] = useState<LogMessage[]>([]);
  const [minSeverity, setMinSeverity] = useState(7);
  const [autoscroll, setAutoscroll] = useState(true);

  // Filtering and sorting
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Graph
  const [showGraph, setShowGraph] = useState(false);
  const [activeChannels, setActiveChannels] = useState<Record<ChannelKey, boolean>>({
    altitude: true,
    speed: false,
    battery: false,
    rssi: false,
  });

  const logRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);

  // ── Debounce search input (300ms) ──────────────────────────

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Subscribe to STATUSTEXT messages from the protocol ─────

  useEffect(() => {
    const protocol = getProtocol();
    if (!protocol) return;

    const unsub = protocol.onStatusText((data) => {
      setMessages((prev) => {
        const msg: LogMessage = {
          id: msgIdRef.current++,
          timestamp: Date.now(),
          severity: data.severity,
          text: data.text,
        };
        const next = [...prev, msg];
        return next.length > MAX_LOG_MESSAGES ? next.slice(-MAX_LOG_MESSAGES) : next;
      });
    });

    return unsub;
  }, [getProtocol, droneId]);

  // ── Auto-scroll log to bottom ──────────────────────────────

  useEffect(() => {
    if (autoscroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, autoscroll]);

  // ── Build graph data from telemetry ring buffers ───────────

  const vfrBuffer = useTelemetryStore((s) => s.vfr);
  const batteryBuffer = useTelemetryStore((s) => s.battery);
  const rcBuffer = useTelemetryStore((s) => s.rc);

  const vfrArr = vfrBuffer.toArray();
  const batteryArr = batteryBuffer.toArray();
  const rcArr = rcBuffer.toArray();

  const graphData = vfrArr.map((v, i) => ({
    time: i,
    altitude: v.alt,
    speed: v.groundspeed,
    battery: batteryArr[Math.min(i, batteryArr.length - 1)]?.voltage ?? 0,
    rssi: rcArr[Math.min(i, rcArr.length - 1)]?.rssi ?? 0,
  }));

  // ── Filtered, searched, and sorted messages ────────────────

  const processedMessages = useMemo(() => {
    let filtered = messages.filter((m) => m.severity <= minSeverity);

    // Category filter
    if (categoryFilter !== "all") {
      filtered = filtered.filter((m) => matchesCategory(m, categoryFilter));
    }

    // Text search
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter((m) => m.text.toLowerCase().includes(q));
    }

    // Sort
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "timestamp": cmp = a.timestamp - b.timestamp; break;
        case "severity": cmp = a.severity - b.severity; break;
        case "text": cmp = a.text.localeCompare(b.text); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [messages, minSeverity, categoryFilter, debouncedSearch, sortField, sortDir]);

  // ── Export log to text file ────────────────────────────────

  const exportLog = useCallback(() => {
    const lines = processedMessages.map((m) => {
      const time = new Date(m.timestamp).toISOString();
      const sev = SEVERITY_LABELS[m.severity] ?? "UNKNOWN";
      return `[${time}] [${sev}] ${m.text}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `altnautica-log-${droneId}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [processedMessages, droneId]);

  // ── Helpers ────────────────────────────────────────────────

  const toggleChannel = (key: ChannelKey) => {
    setActiveChannels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default flex-wrap">
        {/* Severity filter */}
        <Select
          value={String(minSeverity)}
          onChange={(v) => setMinSeverity(Number(v))}
          options={SEVERITY_LABELS.map((label, i) => ({ value: String(i), label }))}
          className="text-[11px]"
        />

        {/* Category filter */}
        <Select
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v as CategoryFilter)}
          options={[
            { value: "all", label: t("allMessages") },
            { value: "error", label: t("errors") },
            { value: "warning", label: t("warnings") },
            { value: "info", label: t("info") },
            { value: "arm", label: t("armDisarm") },
            { value: "mode", label: t("modeChanges") },
            { value: "gps", label: t("gps") },
            { value: "battery", label: t("batteryFilter") },
            { value: "failsafe", label: t("failsafe") },
            { value: "ekf", label: t("ekf") },
            { value: "calibration", label: t("calibration") },
          ]}
          className="text-[11px]"
        />

        <span className="text-[10px] text-text-tertiary font-mono">
          {processedMessages.length} {t("msgs")}
        </span>

        <div className="flex-1" />

        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoscroll((p) => !p)}
          className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] transition-colors cursor-pointer ${
            autoscroll ? "text-accent-primary" : "text-text-tertiary"
          }`}
          title={autoscroll ? "Auto-scroll on" : "Auto-scroll off"}
        >
          {autoscroll ? <Play size={10} /> : <Pause size={10} />}
          {autoscroll ? t("auto") : t("paused")}
        </button>

        {/* Export */}
        <button
          onClick={exportLog}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title={t("exportLog")}
        >
          <Download size={10} />
        </button>

        {/* Clear */}
        <button
          onClick={() => setMessages([])}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          title={t("clearLog")}
        >
          <Trash2 size={10} />
        </button>

        {/* Graph toggle */}
        <button
          onClick={() => setShowGraph((p) => !p)}
          className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] transition-colors cursor-pointer ${
            showGraph ? "text-accent-primary" : "text-text-secondary hover:text-text-primary"
          }`}
          title={t(showGraph ? "hideGraph" : "showGraph")}
        >
          <Activity size={10} />
        </button>
      </div>

      {/* ── Search bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border-default">
        <Search size={12} className="text-text-tertiary shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("searchMessages")}
          className="flex-1 bg-transparent text-[11px] font-mono text-text-primary placeholder:text-text-tertiary outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="text-[10px] text-text-tertiary hover:text-text-primary cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Column headers (sortable) ─────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1 border-b border-border-default bg-bg-tertiary/30">
        <button
          onClick={() => handleSort("timestamp")}
          className="flex items-center gap-0.5 text-[9px] font-mono text-text-tertiary hover:text-text-secondary cursor-pointer shrink-0 w-[60px]"
        >
          {t("time")} <SortIcon field="timestamp" sortField={sortField} sortDir={sortDir} />
        </button>
        <button
          onClick={() => handleSort("severity")}
          className="flex items-center gap-0.5 text-[9px] font-mono text-text-tertiary hover:text-text-secondary cursor-pointer shrink-0 w-[72px]"
        >
          {t("severity")} <SortIcon field="severity" sortField={sortField} sortDir={sortDir} />
        </button>
        <button
          onClick={() => handleSort("text")}
          className="flex items-center gap-0.5 text-[9px] font-mono text-text-tertiary hover:text-text-secondary cursor-pointer flex-1"
        >
          {t("message")} <SortIcon field="text" sortField={sortField} sortDir={sortDir} />
        </button>
      </div>

      {/* ── Message list ─────────────────────────────────────── */}
      <div
        ref={logRef}
        className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px] leading-5"
        onMouseEnter={() => setAutoscroll(false)}
        onMouseLeave={() => setAutoscroll(true)}
      >
        {processedMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
            {messages.length === 0
              ? t("waitingForMessages")
              : t("noMessagesMatch")
            }
          </div>
        ) : (
          processedMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 px-3 py-0.5 hover:bg-bg-tertiary/50 ${
                SEVERITY_BG[msg.severity] ?? ""
              }`}
            >
              <span className="text-text-tertiary shrink-0 w-[60px]">
                {formatTime(msg.timestamp)}
              </span>
              <span
                className={`shrink-0 w-[72px] font-semibold ${
                  SEVERITY_COLORS[msg.severity] ?? "text-text-tertiary"
                }`}
              >
                {SEVERITY_LABELS[msg.severity] ?? "?"}
              </span>
              <span className="text-text-primary break-all">
                <HighlightedText text={msg.text} query={debouncedSearch} />
              </span>
            </div>
          ))
        )}
      </div>

      {/* ── Telemetry graph (collapsible) ────────────────────── */}
      {showGraph && (
        <div className="border-t border-border-default">
          {/* Channel toggles */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border-default">
            {GRAPH_CHANNELS.map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => toggleChannel(key)}
                className={`flex items-center gap-1 text-[10px] transition-colors cursor-pointer ${
                  activeChannels[key] ? "text-text-primary" : "text-text-tertiary"
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: activeChannels[key] ? color : "#333" }}
                />
                {label}
              </button>
            ))}
          </div>

          {/* Chart */}
          <div className="h-[150px] bg-bg-secondary p-2">
            {graphData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={graphData}>
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#666" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#666" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#111116",
                      border: "1px solid #333",
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "#888" }}
                  />
                  {activeChannels.altitude && (
                    <Line type="monotone" dataKey="altitude" stroke="#3A82FF" dot={false} strokeWidth={1.5} />
                  )}
                  {activeChannels.speed && (
                    <Line type="monotone" dataKey="speed" stroke="#DFF140" dot={false} strokeWidth={1.5} />
                  )}
                  {activeChannels.battery && (
                    <Line type="monotone" dataKey="battery" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                  )}
                  {activeChannels.rssi && (
                    <Line type="monotone" dataKey="rssi" stroke="#f97316" dot={false} strokeWidth={1.5} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
                Telemetry data will appear here when connected
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
