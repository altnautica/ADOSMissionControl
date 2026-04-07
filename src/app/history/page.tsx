"use client";

import { useState, useMemo, useEffect, useCallback, useDeferredValue, useRef } from "react";
import { HistoryToolbar, type DatePreset } from "@/components/history/HistoryToolbar";
import { HistoryTable, type SortKey, type SortDir } from "@/components/history/HistoryTable";
import { HistoryDetailPanel } from "@/components/history/detail/HistoryDetailPanel";
import { HistoryStatsBar } from "@/components/history/HistoryStatsBar";
import { HistoryBulkActions } from "@/components/history/HistoryBulkActions";
import { ReplayView } from "@/components/history/ReplayView";
import { EmptyState } from "@/components/history/EmptyState";
import { useHistoryStore } from "@/stores/history-store";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import { isDemoMode } from "@/lib/utils";
import type { FlightRecord } from "@/lib/types";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";

const DAY_MS = 86_400_000;

function presetToRange(preset: DatePreset): { fromMs?: number; toMs?: number } {
  if (preset === "all") return {};
  const now = Date.now();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (preset === "today") return { fromMs: start.getTime(), toMs: now };
  if (preset === "7d") return { fromMs: now - 7 * DAY_MS, toMs: now };
  if (preset === "30d") return { fromMs: now - 30 * DAY_MS, toMs: now };
  if (preset === "month") {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return { fromMs: monthStart.getTime(), toMs: now };
  }
  return {};
}

export default function FlightHistoryPage() {
  // Load any persisted history + operator profile + aircraft registry from
  // IndexedDB on first mount. All three are idempotent.
  const loadFromIDB = useHistoryStore((s) => s.loadFromIDB);
  const loadOperator = useOperatorProfileStore((s) => s.loadFromIDB);
  const loadAircraft = useAircraftRegistryStore((s) => s.loadFromIDB);
  const initWithSeedData = useHistoryStore((s) => s.initWithSeedData);
  const resetDemoData = useHistoryStore((s) => s.resetDemoData);

  useEffect(() => {
    void loadOperator();
    void loadAircraft();

    // In demo mode: if the seed version stored in localStorage is older
    // than the current bundled DEMO_SEED_VERSION, drop persisted records
    // (they're either stale demo data or live mock-engine stubs) and
    // re-seed. Otherwise, fall back to a normal IDB load.
    if (!isDemoMode()) {
      void loadFromIDB();
      return;
    }

    let cancelled = false;
    void (async () => {
      const mod = await import("@/mock/history");
      const { seedDemoHistory, seedDemoTelemetryRecordings, DEMO_SEED_VERSION } = mod;
      const versionKey = "history.demoSeedVersion";
      const stored =
        typeof window !== "undefined" ? window.localStorage.getItem(versionKey) : null;
      const storedVersion = stored ? parseInt(stored, 10) : -1;

      if (storedVersion !== DEMO_SEED_VERSION) {
        await resetDemoData();
      } else {
        await loadFromIDB();
      }
      if (cancelled) return;

      const records = seedDemoHistory();
      await seedDemoTelemetryRecordings(records);
      if (cancelled) return;
      initWithSeedData(records);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(versionKey, String(DEMO_SEED_VERSION));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadFromIDB, loadOperator, loadAircraft, initWithSeedData, resetDemoData]);

  const allRecords = useHistoryStore((s) => s.records);

  // Filter state
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("all");
  const [droneFilter, setDroneFilter] = useState("all");
  const [suiteFilter, setSuiteFilter] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState("date-desc");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Selection state (multi-select)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  // Detail panel selection
  const [selectedRecord, setSelectedRecord] = useState<FlightRecord | null>(null);

  // List width (resizable when a flight is selected)
  const LIST_WIDTH_MIN = 280;
  const LIST_WIDTH_MAX = 560;
  const LIST_WIDTH_DEFAULT = 360;
  const [listWidth, setListWidth] = useState<number>(LIST_WIDTH_DEFAULT);
  const [listCollapsed, setListCollapsed] = useState<boolean>(false);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("history.listWidth");
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n)) setListWidth(Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, n)));
    }
    const collapsed = window.localStorage.getItem("history.listCollapsed");
    if (collapsed === "1") setListCollapsed(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("history.listWidth", String(listWidth));
  }, [listWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("history.listCollapsed", listCollapsed ? "1" : "0");
  }, [listCollapsed]);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = { startX: e.clientX, startWidth: listWidth };
  }, [listWidth]);

  const handleResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) return;
    const dx = e.clientX - resizingRef.current.startX;
    const next = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, resizingRef.current.startWidth + dx));
    setListWidth(next);
  }, []);

  const handleResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).hasPointerCapture?.(e.pointerId)) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
    resizingRef.current = null;
  }, []);

  const toggleListCollapsed = useCallback(() => setListCollapsed((v) => !v), []);

  // Replay mode
  const [replayState, setReplayState] = useState<{ recording: TelemetryRecording; record: FlightRecord } | null>(null);

  const handleReplay = useCallback((recording: TelemetryRecording) => {
    if (selectedRecord) {
      setReplayState({ recording, record: selectedRecord });
    }
  }, [selectedRecord]);

  const handleExitReplay = useCallback(() => {
    setReplayState(null);
  }, []);

  const handleSetDateFrom = useCallback((v: string) => {
    setDateFrom(v);
    if (v) setDatePreset("all");
  }, []);
  const handleSetDateTo = useCallback((v: string) => {
    setDateTo(v);
    if (v) setDatePreset("all");
  }, []);
  const handleSetDatePreset = useCallback((p: DatePreset) => {
    setDatePreset(p);
    if (p !== "all") {
      setDateFrom("");
      setDateTo("");
    }
  }, []);

  const handleReset = useCallback(() => {
    setSearch("");
    setDatePreset("all");
    setDateFrom("");
    setDateTo("");
    setStatus("all");
    setDroneFilter("all");
    setSuiteFilter("all");
    setFavoritesOnly(false);
    setSort("date-desc");
    setSortKey("date");
    setSortDir("desc");
    setSelectedIds(new Set());
  }, []);

  const handleSortChange = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev !== key) {
        setSortDir("desc");
        return key;
      }
      // Toggle dir; if already asc, reset to default (date desc).
      setSortDir((d) => {
        if (d === "desc") return "asc";
        // 3rd click → default
        return "desc";
      });
      // If we just toggled to asc and previously was asc, reset key to default
      // (handled implicitly by checking the toggled-to value below).
      return key;
    });
  }, []);

  const handleToggleSelect = useCallback((id: string, range: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (range && lastClickedRef.current) {
        // Range select between lastClickedRef.current and id within current visible page order.
        // Simplification: just toggle the single item; full range select needs page records.
        // (Phase 26 will deepen this.)
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      lastClickedRef.current = id;
      return next;
    });
  }, []);

  const handleSelectAllPage = useCallback((ids: string[], allSelected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, []);

  // Unique drone names for the filter
  const droneNames = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of allRecords) {
      if (!seen.has(r.droneId)) seen.set(r.droneId, r.droneName);
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [allRecords]);

  // Filtered and sorted records
  const filteredRecords = useMemo(() => {
    let records = [...allRecords];

    // Search (deferred)
    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      records = records.filter((r) => {
        const hay = [
          r.customName,
          r.droneName,
          r.notes,
          ...(r.tags ?? []),
          r.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    // Date preset takes precedence over manual range
    if (datePreset !== "all") {
      const { fromMs, toMs } = presetToRange(datePreset);
      if (fromMs !== undefined) records = records.filter((r) => (r.startTime ?? r.date) >= fromMs);
      if (toMs !== undefined) records = records.filter((r) => (r.startTime ?? r.date) <= toMs);
    } else {
      if (dateFrom) {
        const from = new Date(dateFrom).getTime();
        records = records.filter((r) => (r.startTime ?? r.date) >= from);
      }
      if (dateTo) {
        const tov = new Date(dateTo).getTime() + DAY_MS;
        records = records.filter((r) => (r.startTime ?? r.date) <= tov);
      }
    }

    if (status !== "all") records = records.filter((r) => r.status === status);
    if (droneFilter !== "all") records = records.filter((r) => r.droneId === droneFilter);
    if (suiteFilter !== "all") records = records.filter((r) => r.suiteType === suiteFilter);
    if (favoritesOnly) records = records.filter((r) => r.favorite === true);

    // Sort: column-header sort takes precedence over the legacy `sort` Select
    const dirSign = sortDir === "desc" ? -1 : 1;
    switch (sortKey) {
      case "date":
        records.sort((a, b) => dirSign * ((b.startTime ?? b.date) - (a.startTime ?? a.date)));
        break;
      case "drone":
        records.sort((a, b) => dirSign * b.droneName.localeCompare(a.droneName));
        break;
      case "duration":
        records.sort((a, b) => dirSign * (b.duration - a.duration));
        break;
      case "distance":
        records.sort((a, b) => dirSign * (b.distance - a.distance));
        break;
      case "maxAlt":
        records.sort((a, b) => dirSign * (b.maxAlt - a.maxAlt));
        break;
      case "battery":
        records.sort((a, b) => dirSign * (b.batteryUsed - a.batteryUsed));
        break;
    }

    return records;
  }, [allRecords, deferredSearch, datePreset, dateFrom, dateTo, status, droneFilter, suiteFilter, favoritesOnly, sortKey, sortDir]);

  // Replay mode: full-screen replay replaces table
  if (replayState) {
    return (
      <ReplayView
        recording={replayState.recording}
        flightRecord={replayState.record}
        onExit={handleExitReplay}
      />
    );
  }

  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default shrink-0">
        <h1 className="text-sm font-display font-semibold text-text-primary">Flight History</h1>
      </div>

      {/* Toolbar */}
      <HistoryToolbar
        search={search}
        dateFrom={dateFrom}
        dateTo={dateTo}
        datePreset={datePreset}
        status={status}
        droneFilter={droneFilter}
        suiteFilter={suiteFilter}
        sort={sort}
        favoritesOnly={favoritesOnly}
        droneNames={droneNames}
        records={filteredRecords}
        onSearchChange={setSearch}
        onDateFromChange={handleSetDateFrom}
        onDateToChange={handleSetDateTo}
        onDatePresetChange={handleSetDatePreset}
        onStatusChange={setStatus}
        onDroneFilterChange={setDroneFilter}
        onSuiteFilterChange={setSuiteFilter}
        onSortChange={setSort}
        onFavoritesOnlyChange={setFavoritesOnly}
        onReset={handleReset}
      />

      {/* Stats bar */}
      {allRecords.length > 0 && <HistoryStatsBar records={filteredRecords} />}

      {/* Table + Detail */}
      <div className="flex flex-1 overflow-hidden">
        {allRecords.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {!(selectedRecord && listCollapsed) && (
              <div
                className="h-full overflow-hidden"
                style={
                  selectedRecord
                    ? { width: listWidth, flex: "0 0 auto" }
                    : { flex: "1 1 auto", minWidth: 0 }
                }
              >
                <HistoryTable
                  records={filteredRecords}
                  selectedId={selectedRecord?.id ?? null}
                  onSelect={setSelectedRecord}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                  onSelectAllPage={handleSelectAllPage}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSortChange={handleSortChange}
                  compact={!!selectedRecord}
                />
              </div>
            )}

            {selectedRecord && !listCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                onPointerDown={handleResizeStart}
                onPointerMove={handleResizeMove}
                onPointerUp={handleResizeEnd}
                onPointerCancel={handleResizeEnd}
                className="w-1 shrink-0 cursor-col-resize bg-border-default hover:bg-accent-primary/60 transition-colors"
                title="Drag to resize"
              />
            )}

            {selectedRecord && (
              <HistoryDetailPanel
                record={selectedRecord}
                onClose={() => setSelectedRecord(null)}
                onReplay={handleReplay}
                listCollapsed={listCollapsed}
                onToggleListCollapsed={toggleListCollapsed}
              />
            )}
          </>
        )}
      </div>

      <HistoryBulkActions
        records={filteredRecords}
        selectedIds={selectedIds}
        onClearSelection={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
