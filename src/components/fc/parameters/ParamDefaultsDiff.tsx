"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import type { ParameterValue } from "@/lib/protocol/types";

interface ParamDefaultsDiffProps {
  parameters: ParameterValue[];
  modified: Map<string, number>;
  metadata: Map<string, ParamMetadata>;
}

interface DiffEntry {
  name: string;
  currentValue: number;
  defaultValue: number;
  difference: number;
}

export function ParamDefaultsDiff({ parameters, modified, metadata }: ParamDefaultsDiffProps) {
  const [search, setSearch] = useState("");

  const diffs = useMemo(() => {
    const result: DiffEntry[] = [];
    for (const p of parameters) {
      const meta = metadata.get(p.name);
      if (meta?.defaultValue === undefined) continue;
      const current = modified.has(p.name) ? modified.get(p.name)! : p.value;
      if (current !== meta.defaultValue) {
        result.push({
          name: p.name,
          currentValue: current,
          defaultValue: meta.defaultValue,
          difference: parseFloat((current - meta.defaultValue).toPrecision(10)),
        });
      }
    }
    return result;
  }, [parameters, modified, metadata]);

  const filtered = useMemo(() => {
    if (!search) return diffs;
    const q = search.toUpperCase();
    return diffs.filter((d) => d.name.includes(q));
  }, [diffs, search]);

  const totalWithMeta = useMemo(() => {
    return parameters.filter((p) => metadata.get(p.name)?.defaultValue !== undefined).length;
  }, [parameters, metadata]);

  return (
    <div className="flex flex-col gap-3 max-h-[70vh]">
      {/* Summary */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="warning" size="sm">{diffs.length} non-default</Badge>
        <Badge variant="neutral" size="sm">{totalWithMeta - diffs.length} at default</Badge>
        <span className="text-[10px] text-text-tertiary">
          ({totalWithMeta} params with known defaults)
        </span>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter params..."
          className="w-full h-7 pl-7 pr-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
        />
      </div>

      {/* Diff table */}
      <div className="flex-1 overflow-y-auto min-h-0 border border-border-default">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg-tertiary border-b border-border-default z-10">
            <tr>
              <th className="px-3 py-1.5 text-left text-text-tertiary font-semibold uppercase tracking-wider text-[10px]">Parameter</th>
              <th className="px-3 py-1.5 text-right text-text-tertiary font-semibold uppercase tracking-wider text-[10px] w-28">Current</th>
              <th className="px-3 py-1.5 text-right text-text-tertiary font-semibold uppercase tracking-wider text-[10px] w-28">Default</th>
              <th className="px-3 py-1.5 text-right text-text-tertiary font-semibold uppercase tracking-wider text-[10px] w-28">Diff</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.name} className="border-b border-border-default/50 hover:bg-bg-tertiary/50 transition-colors">
                <td className="px-3 py-1.5 font-mono text-text-primary">{d.name}</td>
                <td className={cn(
                  "px-3 py-1.5 text-right font-mono",
                  "text-status-warning"
                )}>
                  {d.currentValue}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-text-secondary">
                  {d.defaultValue}
                </td>
                <td className={cn(
                  "px-3 py-1.5 text-right font-mono",
                  d.difference > 0 ? "text-status-success" : d.difference < 0 ? "text-status-error" : "text-text-tertiary"
                )}>
                  {d.difference > 0 ? "+" : ""}{d.difference}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-tertiary text-xs">
                  {diffs.length === 0
                    ? "All parameters are at their default values."
                    : "No matching parameters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
