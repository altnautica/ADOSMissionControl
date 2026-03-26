/**
 * @module useDroneLogFilter
 * @description Hook that encapsulates drone log filtering, searching, and sorting logic.
 * Extracted from DroneLogsPanel.tsx.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────

export interface LogMessage {
  id: number;
  timestamp: number;
  severity: number;
  text: string;
}

export type SortField = "timestamp" | "severity" | "text";
export type SortDir = "asc" | "desc";

export const SEVERITY_LABELS = [
  "EMERGENCY",
  "ALERT",
  "CRITICAL",
  "ERROR",
  "WARNING",
  "NOTICE",
  "INFO",
  "DEBUG",
] as const;

export const SEVERITY_COLORS: Record<number, string> = {
  0: "text-red-500",
  1: "text-red-500",
  2: "text-red-400",
  3: "text-red-400",
  4: "text-yellow-400",
  5: "text-blue-400",
  6: "text-green-400",
  7: "text-text-tertiary",
};

export const SEVERITY_BG: Record<number, string> = {
  0: "bg-red-500/10",
  1: "bg-red-500/10",
  2: "bg-red-400/10",
  3: "bg-red-400/10",
  4: "bg-yellow-400/10",
  5: "bg-blue-400/10",
  6: "bg-green-400/10",
  7: "bg-transparent",
};

export type CategoryFilter = "all" | "error" | "warning" | "info" | "arm" | "mode" | "gps" | "battery" | "failsafe" | "ekf" | "calibration";

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

// ── Hook ─────────────────────────────────────────────────────

export function useDroneLogFilter(messages: LogMessage[]) {
  const [minSeverity, setMinSeverity] = useState(7);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // Filtered, searched, and sorted messages
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

  return {
    // Filter state
    minSeverity,
    setMinSeverity,
    categoryFilter,
    setCategoryFilter,
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    sortField,
    sortDir,
    handleSort,
    // Result
    processedMessages,
  };
}
