"use client";

import { useState, useEffect, useCallback, useMemo, useReducer } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockTick } from "@/lib/agent/freshness";
import { isFresh } from "@/lib/telemetry/freshness";
import { Bug, Download, Table2, BarChart3, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MiniChart, exportCSV,
  GRAPH_COLORS, MAX_GRAPH_KEYS,
  type ViewMode,
} from "./debug-helpers";
import { DebugChannels } from "./debug-channels";

export function DebugPanel() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  // Every telemetry push bumps the version, however full the rings are; the
  // 1 Hz tick keeps the "Last Update" ages counting when messages stop.
  const telemetryVersion = useTelemetryStore((s) => s._version);
  useClockTick();

  const [view, setView] = useState<ViewMode>("table");
  const [selectedGraphKeys, setSelectedGraphKeys] = useState<string[]>([]);
  const [channels] = useState(() => new DebugChannels());
  const [revision, bumpRevision] = useReducer((n: number) => n + 1, 0);

  // A newly selected drone starts from an empty table.
  useEffect(() => {
    channels.reset();
    setSelectedGraphKeys([]);
    bumpRevision();
  }, [selectedDroneId, channels]);

  // NAMED_VALUE_FLOAT / NAMED_VALUE_INT / DEBUG entries, plus the
  // vision-navigation derived channels, folded into one set of named values.
  useEffect(() => {
    const s = useTelemetryStore.getState();
    const debug = channels.drain("debug", s.debug.toArray(), (e) => e.timestamp, (e) => ({
      key: e.type === "debug" ? `DEBUG[${e.name}]` : e.name,
      type: e.type,
      value: e.value,
    }));
    const flowQ = channels.drain("flowQuality", s.flowQuality.toArray(), (e) => e.ts, (e) => ({
      key: "Flow Quality", type: "int", value: e.value,
    }));
    const flowD = channels.drain("flowDistance", s.flowDistance.toArray(), (e) => e.ts, (e) => ({
      key: "Flow Distance", type: "float", value: e.value,
    }));
    const vioQ = channels.drain("vioQuality", s.vioQuality.toArray(), (e) => e.ts, (e) => ({
      key: "VIO Quality", type: "float", value: e.value,
    }));
    if (debug || flowQ || flowD || vioQ) bumpRevision();
  }, [telemetryVersion, selectedDroneId, channels]);

  const toggleGraphKey = useCallback((key: string) => {
    setSelectedGraphKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_GRAPH_KEYS) return prev;
      return [...prev, key];
    });
  }, []);

  const clearAll = useCallback(() => {
    channels.clear();
    setSelectedGraphKeys([]);
    bumpRevision();
  }, [channels]);

  const values = channels.values;
  // `revision` is what changes when `channels` was mutated in place.
  const sortedValues = useMemo(
    () => Array.from(channels.values.values()).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, revision],
  );
  const now = Date.now();

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Bug size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">Debug Values</span>
        <span className="text-[10px] text-text-tertiary font-mono">{values.size} value{values.size !== 1 ? "s" : ""}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 bg-bg-tertiary p-0.5 rounded">
          <button onClick={() => setView("table")} className={cn("flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer rounded transition-colors", view === "table" ? "bg-bg-secondary text-text-primary" : "text-text-tertiary hover:text-text-secondary")}><Table2 size={10} />Table</button>
          <button onClick={() => setView("graph")} className={cn("flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer rounded transition-colors", view === "graph" ? "bg-bg-secondary text-text-primary" : "text-text-tertiary hover:text-text-secondary")}><BarChart3 size={10} />Graph</button>
        </div>
        <button onClick={() => exportCSV(values, channels.allHistory())} disabled={values.size === 0} className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-default"><Download size={10} />Export CSV</button>
        <button onClick={clearAll} disabled={values.size === 0} className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-default"><Trash2 size={10} />Clear</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {values.size === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
            <Bug size={24} className="text-text-tertiary" />
            <span className="text-xs text-text-tertiary">No debug values received</span>
            <span className="text-[10px] text-text-tertiary">{selectedDroneId ? "Waiting for NAMED_VALUE_FLOAT, NAMED_VALUE_INT, or DEBUG messages..." : "Connect a drone to see debug values"}</span>
          </div>
        ) : view === "table" ? (
          <div className="font-mono text-[10px]">
            <div className="flex items-center gap-0 px-4 py-1 border-b border-border-default bg-bg-tertiary text-text-tertiary sticky top-0 z-10">
              <span className="w-[200px] shrink-0">Name</span>
              <span className="w-[100px] shrink-0 text-right">Value</span>
              <span className="w-[60px] shrink-0 text-center">Type</span>
              <span className="w-[80px] shrink-0 text-right">Last Update</span>
            </div>
            {sortedValues.map((dv) => {
              const ago = (now - dv.lastUpdate) / 1000;
              const stale = !isFresh(dv.lastUpdate, now);
              return (
                <div key={dv.name} className="flex items-center gap-0 px-4 py-0.5 hover:bg-bg-tertiary/50">
                  <span className="w-[200px] shrink-0 text-accent-primary truncate">{dv.name}</span>
                  <span className="w-[100px] shrink-0 text-right text-text-primary tabular-nums">{typeof dv.value === "number" ? (Number.isInteger(dv.value) ? dv.value.toString() : dv.value.toFixed(4)) : String(dv.value)}</span>
                  <span className="w-[60px] shrink-0 text-center text-text-tertiary">{dv.type}</span>
                  <span className={cn("w-[80px] shrink-0 text-right tabular-nums", stale ? "text-status-warning" : "text-text-tertiary")}>{ago < 0.1 ? "now" : `${ago.toFixed(1)}s`}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <p className="text-[10px] text-text-tertiary">Select up to {MAX_GRAPH_KEYS} values to graph:</p>
              <div className="flex flex-wrap gap-1">
                {sortedValues.map((dv) => {
                  const selected = selectedGraphKeys.includes(dv.name);
                  const colorIdx = selectedGraphKeys.indexOf(dv.name);
                  return (
                    <button key={dv.name} onClick={() => toggleGraphKey(dv.name)} className={cn("px-2 py-0.5 text-[10px] font-mono border cursor-pointer transition-colors", selected ? "border-accent-primary bg-accent-primary/10 text-accent-primary" : "border-border-default text-text-secondary hover:border-text-tertiary")} style={selected && colorIdx >= 0 ? { borderColor: GRAPH_COLORS[colorIdx], color: GRAPH_COLORS[colorIdx] } : undefined}>{dv.name}</button>
                  );
                })}
              </div>
            </div>
            {selectedGraphKeys.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-text-tertiary text-xs">Select values above to view graphs</div>
            ) : (
              <div className="space-y-3">
                {selectedGraphKeys.map((key, idx) => {
                  const hist = channels.historyOf(key);
                  const latest = hist[hist.length - 1];
                  return (
                    <div key={key} className="border border-border-default bg-bg-secondary p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono font-medium" style={{ color: GRAPH_COLORS[idx] }}>{key}</span>
                        <span className="text-[10px] font-mono text-text-tertiary tabular-nums">{latest ? latest.v.toFixed(4) : "\u2014"}</span>
                      </div>
                      <MiniChart data={hist} color={GRAPH_COLORS[idx]} width={500} height={80} />
                      <div className="flex justify-between text-[8px] text-text-tertiary mt-0.5">
                        <span>{hist.length} samples</span>
                        <span>{hist.length > 1 ? `${((hist[hist.length - 1].t - hist[0].t) / 1000).toFixed(1)}s window` : "\u2014"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
