"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { parseParamFile, compareParams, type ParamDiff } from "@/lib/formats/param-file-parser";
import { confirmArmedParamWrite, describeParamBatch, writeParamBatch } from "@/lib/protocol/param-write";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import { cn } from "@/lib/utils";
import {
  Upload, Search, CheckSquare, Square, FileText, PenLine, HardDrive,
} from "lucide-react";
import { STATUS_STYLES, STATUS_LABELS, FILTER_MODES, TH, filterLabel, type FilterMode } from "./param-compare-helpers";

/** Pending-write records from this surface are attributed to the grid it opens from. */
const PANEL_ID = "parameters";

export interface ParamCompareApplied {
  /** Every selected parameter landed on the vehicle. */
  allLanded: boolean;
  /** A parameter that landed needs an FC restart. */
  rebootRequired: boolean;
}

interface ParamCompareProps {
  fcParams: Map<string, number>;
  metadata: Map<string, ParamMetadata>;
  /** Called whenever at least one parameter landed, so the grid re-reads the vehicle. */
  onApplied: (result: ParamCompareApplied) => void;
}

export function ParamCompare({ fcParams, metadata, onApplied }: ParamCompareProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<ParamDiff[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState({ current: 0, total: 0 });

  const stats = useMemo(() => {
    let changed = 0, added = 0, unchanged = 0;
    for (const d of diffs) {
      if (d.status === "changed") changed++;
      else if (d.status === "added") added++;
      else unchanged++;
    }
    return { changed, added, unchanged, total: diffs.length };
  }, [diffs]);

  const filteredDiffs = useMemo(() => {
    let result = diffs;
    if (filterMode !== "all") {
      result = result.filter((d) => d.status === filterMode);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((d) => d.name.toLowerCase().includes(q));
    }
    return result;
  }, [diffs, filterMode, search]);

  const handleFileLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseParamFile(text);
      if (parsed.length === 0) {
        toast("No parameters found in that file", "error");
        setDiffs([]);
        setFileName(file.name);
        setSelected(new Set());
        return;
      }
      const diffResult = compareParams(parsed, fcParams);
      setDiffs(diffResult);
      setFileName(file.name);
      // Auto-select all changed params
      const autoSelected = new Set<string>();
      for (const d of diffResult) {
        if (d.status === "changed") autoSelected.add(d.name);
      }
      setSelected(autoSelected);
      setSearch("");
      setFilterMode("all");
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [fcParams, toast]);

  const selectableCount = useMemo(
    () => diffs.filter((d) => d.status === "changed" || d.status === "added").length,
    [diffs]
  );

  const handleSelectAll = useCallback(() => {
    const all = new Set<string>();
    for (const d of diffs) {
      if (d.status === "changed" || d.status === "added") all.add(d.name);
    }
    setSelected(all);
  }, [diffs]);

  const handleSelectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const toggleParam = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleApply = useCallback(async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol || selected.size === 0) return;

    const entries = diffs.filter((d) => selected.has(d.name));
    // Same armed-write guard as every other parameter write: one confirmation
    // naming the whole batch before anything reaches the vehicle.
    const confirmed = await confirmArmedParamWrite(PANEL_ID, entries.map((d) => d.name));
    if (!confirmed) return;

    setApplying(true);
    setApplyProgress({ current: 0, total: entries.length });
    const outcome = await writeParamBatch(
      protocol,
      entries.map((d) => ({
        name: d.name,
        value: d.fileValue,
        oldValue: d.fcValue ?? 0,
        rebootRequired: metadata.get(d.name)?.rebootRequired,
      })),
      PANEL_ID,
      (current, total) => setApplyProgress({ current, total }),
    );

    const summary = describeParamBatch(outcome);
    const shown = outcome.failures.slice(0, 5).join(", ");
    const more = outcome.failures.length > 5 ? ` and ${outcome.failures.length - 5} more` : "";
    const failed = outcome.failures.length > 0 ? `. Failed: ${shown}${more}` : "";
    toast(`${summary.message}${failed}`, summary.level);

    if (outcome.written.size > 0) {
      // What landed now matches the file; what failed stays selected so the
      // operator can retry it without re-loading the file.
      setDiffs((prev) => prev.map((d) => (
        outcome.written.has(d.name) ? { ...d, fcValue: d.fileValue, status: "unchanged" } : d
      )));
      setSelected((prev) => new Set([...prev].filter((n) => !outcome.written.has(n))));
      onApplied({ allLanded: outcome.failures.length === 0, rebootRequired: outcome.rebootRequired });
    }

    setApplying(false);
    setApplyProgress({ current: 0, total: 0 });
  }, [diffs, selected, metadata, toast, onApplied]);

  return (
    <div className="flex flex-col gap-4 max-h-[70vh]">
      {/* File loader */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={12} />}
          onClick={() => fileInputRef.current?.click()}
        >
          Load .param File
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".param,.params,.parm,.txt"
          className="hidden"
          onChange={handleFileLoad}
        />
        {fileName && (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <FileText size={12} />
            <span className="font-mono">{fileName}</span>
            <span className="text-text-tertiary">({stats.total} params)</span>
          </div>
        )}
      </div>

      {diffs.length > 0 && (
        <>
          {/* Summary */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="warning" size="sm">{stats.changed} changed</Badge>
            <Badge variant="info" size="sm">{stats.added} new</Badge>
            <Badge variant="neutral" size="sm">{stats.unchanged} unchanged</Badge>
            <div className="w-px h-4 bg-border-default" />
            <Button variant="ghost" size="sm" icon={<CheckSquare size={12} />} onClick={handleSelectAll} disabled={selectableCount === 0}>
              Select All
            </Button>
            <Button variant="ghost" size="sm" icon={<Square size={12} />} onClick={handleSelectNone} disabled={selected.size === 0}>
              Select None
            </Button>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter params..."
                className="w-full h-7 pl-7 pr-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
              />
            </div>
            {FILTER_MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={cn(
                  "px-2 py-1 text-[10px] uppercase tracking-wider font-semibold transition-colors cursor-pointer",
                  filterMode === mode
                    ? "text-accent-primary bg-accent-primary/10"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                {filterLabel(mode, stats)}
              </button>
            ))}
          </div>

          {/* Diff table */}
          <div className="flex-1 overflow-y-auto min-h-0 border border-border-default">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-tertiary border-b border-border-default z-10"><tr>
                <th className="w-8 px-2 py-1.5 text-left"></th>
                <th className={cn(TH, "text-left")}>Parameter</th>
                <th className={cn(TH, "text-right w-28")}>FC Value</th>
                <th className={cn(TH, "text-right w-28")}>File Value</th>
                <th className={cn(TH, "text-center w-20")}>Status</th>
              </tr></thead>
              <tbody>
                {filteredDiffs.map((d) => {
                  const selectable = d.status === "changed" || d.status === "added";
                  const isSelected = selected.has(d.name);
                  return (
                    <tr
                      key={d.name}
                      onClick={() => selectable && toggleParam(d.name)}
                      className={cn(
                        "border-b border-border-default/50 transition-colors",
                        selectable && "cursor-pointer hover:bg-bg-tertiary/50",
                        isSelected && "bg-accent-primary/5"
                      )}
                    >
                      <td className="px-2 py-1.5 text-center">
                        {selectable && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleParam(d.name)}
                            className="accent-accent-primary cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-text-primary">{d.name}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-text-secondary">
                        {d.fcValue !== null ? d.fcValue : <span className="text-text-tertiary">&mdash;</span>}
                      </td>
                      <td className={cn(
                        "px-2 py-1.5 text-right font-mono",
                        d.status === "changed" ? "text-status-warning" : "text-text-secondary"
                      )}>
                        {d.fileValue}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={cn("text-[10px] font-semibold uppercase", STATUS_STYLES[d.status])}>
                          {STATUS_LABELS[d.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredDiffs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-text-tertiary text-xs">
                      No parameters match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {applying && applyProgress.total > 0 && (
            <div className="flex items-center gap-3">
              <PenLine size={12} className="text-status-warning flex-shrink-0" />
              <span className="text-xs text-text-secondary">Applying {applyProgress.current}/{applyProgress.total}...</span>
              <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div className="h-full bg-status-warning transition-all duration-200" style={{ width: `${Math.round((applyProgress.current / applyProgress.total) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-tertiary">{selected.size} of {selectableCount} selectable params selected</span>
            <Button variant="primary" size="sm" icon={<HardDrive size={12} />} onClick={handleApply} disabled={selected.size === 0 || applying} loading={applying}>
              Apply {selected.size} Parameter{selected.size !== 1 ? "s" : ""}
            </Button>
          </div>
        </>
      )}

      {!fileName && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-text-tertiary">
          <FileText size={24} strokeWidth={1.5} />
          <p className="text-xs">Load a .param file to compare against current FC parameters</p>
        </div>
      )}
    </div>
  );
}
