"use client";

/**
 * @module drone-detail/Px4EventsFeed
 * @description The decoded PX4 events feed (Logs → Events sub-view). Reads
 * `px4-events-store`, which the Px4EventsBridge fills from the FC's structured
 * events (MAVLink EVENT msg 410) with metadata-resolved text. Newest first,
 * severity-dotted, searchable. Empty until the FC emits an event (no
 * fabricated rows).
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import type { StatusLevel } from "@/lib/status-level";
import { Input } from "@/components/ui/input";
import { usePx4EventsStore } from "@/stores/px4-events-store";

/** External log level (0=emergency … 7=debug) → status dot level. */
function severityLevel(level: number): StatusLevel {
  if (level <= 2) return "critical"; // emergency / alert / critical
  if (level === 3) return "serious"; // error
  if (level === 4) return "warning"; // warning
  return "idle"; // notice / info / debug
}

const SEVERITY_LABEL = [
  "Emergency", "Alert", "Critical", "Error", "Warning", "Notice", "Info", "Debug",
];

export function Px4EventsFeed() {
  const events = usePx4EventsStore((s) => s.events);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? events.filter((e) => e.text.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      : events;
    // Newest first.
    return [...list].reverse();
  }, [events, query]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default flex-shrink-0">
        <ScrollText className="h-3.5 w-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          Flight Controller Events
        </span>
        <span className="text-[10px] text-text-tertiary tabular-nums">
          {events.length}
        </span>
        <div className="ml-auto relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-tertiary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events"
            className="h-7 w-48 pl-7 text-xs"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-[11px] text-text-tertiary">
          {events.length === 0
            ? "No events yet. Structured flight-controller events appear here."
            : "No events match the search."}
        </p>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-border-default">
          {shown.map((e) => (
            <li key={e.key} className="flex items-start gap-2 px-3 py-2">
              <StatusDot
                status={severityLevel(e.severity)}
                size="xs"
                className="mt-1 flex-shrink-0"
                label={SEVERITY_LABEL[e.severity] ?? `level ${e.severity}`}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[12px] text-text-primary leading-tight">
                  {e.text}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-text-tertiary">
                  {e.name}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
