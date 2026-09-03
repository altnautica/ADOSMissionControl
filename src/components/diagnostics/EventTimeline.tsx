"use client";

import { useState, useMemo } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import type { EventType } from "@/stores/diagnostics-store";
import { cn } from "@/lib/utils";
import {
  Clock,
  Filter,
  Trash2,
  Wifi,
  WifiOff,
  Shield,
  ShieldOff,
  RotateCw,
  AlertTriangle,
  Wrench,
  PenLine,
  Save,
  Upload,
  Download,
  RefreshCw,
} from "lucide-react";

// ── Event type config ────────────────────────────────────────

interface EventTypeConfig {
  label: string;
  color: string;
  bgColor: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const EVENT_CONFIG: Record<EventType, EventTypeConfig> = {
  connect: { label: "Connect", color: "text-status-success", bgColor: "bg-status-success/15", Icon: Wifi },
  disconnect: { label: "Disconnect", color: "text-status-error", bgColor: "bg-status-error/15", Icon: WifiOff },
  arm: { label: "Arm", color: "text-status-success", bgColor: "bg-status-success/15", Icon: Shield },
  disarm: { label: "Disarm", color: "text-status-warning", bgColor: "bg-status-warning/15", Icon: ShieldOff },
  mode_change: { label: "Mode", color: "text-accent-primary", bgColor: "bg-accent-primary/15", Icon: RotateCw },
  error: { label: "Error", color: "text-status-error", bgColor: "bg-status-error/15", Icon: AlertTriangle },
  calibration: { label: "Calibration", color: "text-[var(--node-swatch-purple)]", bgColor: "bg-[var(--node-swatch-purple)]/15", Icon: Wrench },
  param_write: { label: "Param Write", color: "text-status-warning", bgColor: "bg-status-warning/15", Icon: PenLine },
  flash_commit: { label: "Flash", color: "text-status-serious", bgColor: "bg-status-serious/15", Icon: Save },
  mission_upload: { label: "Mission Up", color: "text-[var(--node-swatch-cyan)]", bgColor: "bg-[var(--node-swatch-cyan)]/15", Icon: Upload },
  mission_download: { label: "Mission Down", color: "text-[var(--node-swatch-cyan)]", bgColor: "bg-[var(--node-swatch-cyan)]/15", Icon: Download },
  reconnect_attempt: { label: "Reconnect", color: "text-status-warning", bgColor: "bg-status-warning/15", Icon: RefreshCw },
};

const ALL_EVENT_TYPES: EventType[] = [
  "connect", "disconnect", "arm", "disarm", "mode_change",
  "error", "calibration", "param_write", "flash_commit",
  "mission_upload", "mission_download", "reconnect_attempt",
];

// ── Relative time ────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function formatAbsoluteTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-US", { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

// ── Component ────────────────────────────────────────────────

export function EventTimeline() {
  const eventTimeline = useDiagnosticsStore((s) => s.eventTimeline);
  const logEvent = useDiagnosticsStore((s) => s.logEvent);
  const [filterTypes, setFilterTypes] = useState<Set<EventType>>(new Set(ALL_EVENT_TYPES));
  const [showFilter, setShowFilter] = useState(false);

  // Get events newest first
  const events = useMemo(() => {
    const all = eventTimeline.toArray();
    return all
      .filter((e) => filterTypes.has(e.type))
      .reverse();
  }, [eventTimeline, filterTypes]);

  const toggleFilter = (type: EventType) => {
    setFilterTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const selectAll = () => setFilterTypes(new Set(ALL_EVENT_TYPES));
  const selectNone = () => setFilterTypes(new Set());

  // For testing: generate a test event
  void logEvent;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Clock size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">Event Timeline</span>
        <span className="text-[10px] text-text-tertiary font-mono">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>

        <div className="flex-1" />

        <button
          onClick={() => setShowFilter((p) => !p)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer",
            showFilter ? "text-accent-primary" : "text-text-secondary hover:text-text-primary",
          )}
        >
          <Filter size={10} />
          Filter
        </button>
      </div>

      {/* Filter bar */}
      {showFilter && (
        <div className="px-4 py-2 border-b border-border-default bg-bg-tertiary/30">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={selectAll}
              className="px-1.5 py-0.5 text-[9px] text-text-tertiary hover:text-text-secondary cursor-pointer"
            >
              All
            </button>
            <button
              onClick={selectNone}
              className="px-1.5 py-0.5 text-[9px] text-text-tertiary hover:text-text-secondary cursor-pointer"
            >
              None
            </button>
            <span className="w-px h-3 bg-border-default mx-1" />
            {ALL_EVENT_TYPES.map((type) => {
              const config = EVENT_CONFIG[type];
              const active = filterTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleFilter(type)}
                  className={cn(
                    "px-1.5 py-0.5 text-[9px] font-mono border cursor-pointer transition-colors",
                    active
                      ? `border-current ${config.color}`
                      : "border-border-default text-text-tertiary opacity-40",
                  )}
                >
                  {config.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
            <Clock size={24} className="text-text-tertiary" />
            <span className="text-xs text-text-tertiary">No events recorded</span>
            <span className="text-[10px] text-text-tertiary">
              Events like arm/disarm, mode changes, errors, and param writes will appear here
            </span>
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {events.map((event, idx) => {
              const config = EVENT_CONFIG[event.type];
              const IconComp = config.Icon;
              return (
                <div
                  key={`${event.timestamp}-${idx}`}
                  className="flex items-start gap-3 px-4 py-2 hover:bg-bg-tertiary/30 transition-colors"
                >
                  {/* Icon */}
                  <div className={cn("mt-0.5 p-1 rounded", config.bgColor)}>
                    <IconComp size={12} className={config.color} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[10px] font-mono font-medium px-1.5 py-0.5 rounded", config.bgColor, config.color)}>
                        {config.label}
                      </span>
                    </div>
                    <p className="text-xs text-text-primary mt-0.5 break-words">
                      {event.description}
                    </p>
                  </div>

                  {/* Timestamps */}
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[10px] text-text-tertiary tabular-nums">
                      {formatRelativeTime(event.timestamp)}
                    </span>
                    <span className="text-[9px] text-text-tertiary/60 tabular-nums font-mono">
                      {formatAbsoluteTime(event.timestamp)}
                    </span>
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
