"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { HistoryToolbar } from "@/components/history/HistoryToolbar";
import { HistoryTable } from "@/components/history/HistoryTable";
import { HistoryDetailPanel } from "@/components/history/HistoryDetailPanel";
import { ReplayView } from "@/components/history/ReplayView";
import { getFlightHistory } from "@/mock/history";
import { useHistoryStore } from "@/stores/history-store";
import type { FlightRecord } from "@/lib/types";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";

export default function FlightHistoryPage() {
  // Init store with seed data once
  const initWithSeedData = useHistoryStore((s) => s.initWithSeedData);
  useEffect(() => {
    initWithSeedData(getFlightHistory());
  }, [initWithSeedData]);

  const allRecords = useHistoryStore((s) => s.records);

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("all");
  const [droneFilter, setDroneFilter] = useState("all");
  const [suiteFilter, setSuiteFilter] = useState("all");
  const [sort, setSort] = useState("date-desc");

  // Selected record
  const [selectedRecord, setSelectedRecord] = useState<FlightRecord | null>(null);

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

    // Date filter
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      records = records.filter((r) => r.date >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000; // end of day
      records = records.filter((r) => r.date <= to);
    }

    // Status filter
    if (status !== "all") {
      records = records.filter((r) => r.status === status);
    }

    // Drone filter
    if (droneFilter !== "all") {
      records = records.filter((r) => r.droneId === droneFilter);
    }

    // Suite filter
    if (suiteFilter !== "all") {
      records = records.filter((r) => r.suiteType === suiteFilter);
    }

    // Sort
    switch (sort) {
      case "date-asc":
        records.sort((a, b) => a.date - b.date);
        break;
      case "date-desc":
        records.sort((a, b) => b.date - a.date);
        break;
      case "duration-desc":
        records.sort((a, b) => b.duration - a.duration);
        break;
      case "distance-desc":
        records.sort((a, b) => b.distance - a.distance);
        break;
    }

    return records;
  }, [allRecords, dateFrom, dateTo, status, droneFilter, suiteFilter, sort]);

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
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default shrink-0">
        <h1 className="text-sm font-display font-semibold text-text-primary">Flight History</h1>
      </div>

      {/* Toolbar */}
      <HistoryToolbar
        dateFrom={dateFrom}
        dateTo={dateTo}
        status={status}
        droneFilter={droneFilter}
        suiteFilter={suiteFilter}
        sort={sort}
        droneNames={droneNames}
        records={filteredRecords}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onStatusChange={setStatus}
        onDroneFilterChange={setDroneFilter}
        onSuiteFilterChange={setSuiteFilter}
        onSortChange={setSort}
      />

      {/* Table + Detail */}
      <div className="flex flex-1 overflow-hidden">
        <HistoryTable
          records={filteredRecords}
          selectedId={selectedRecord?.id ?? null}
          onSelect={setSelectedRecord}
        />

        {selectedRecord && (
          <HistoryDetailPanel
            record={selectedRecord}
            onClose={() => setSelectedRecord(null)}
            onReplay={handleReplay}
          />
        )}
      </div>
    </div>
  );
}
