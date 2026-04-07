"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import type { FlightRecord } from "@/lib/types";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Star } from "lucide-react";

const PAGE_SIZE = 20;

const statusVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
  completed: "success",
  aborted: "warning",
  emergency: "error",
  in_progress: "neutral",
};

export type SortKey =
  | "date"
  | "drone"
  | "duration"
  | "distance"
  | "maxAlt"
  | "battery";

export type SortDir = "asc" | "desc";

interface HistoryTableProps {
  records: FlightRecord[];
  selectedId: string | null;
  onSelect: (record: FlightRecord) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, range: boolean) => void;
  onSelectAllPage: (ids: string[], allSelected: boolean) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}

function SortHeader({ label, sortKey, activeKey, dir, onClick }: SortHeaderProps) {
  const active = activeKey === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider cursor-pointer select-none hover:text-text-primary"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (dir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
      </span>
    </th>
  );
}

export function HistoryTable({
  records,
  selectedId,
  onSelect,
  selectedIds,
  onToggleSelect,
  onSelectAllPage,
  sortKey,
  sortDir,
  onSortChange,
}: HistoryTableProps) {
  const t = useTranslations("history");
  const [page, setPage] = useState(0);

  // Page is clamped at render-time via safePage; no effect needed.
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRecords = records.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const from = records.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const to = Math.min((safePage + 1) * PAGE_SIZE, records.length);

  const pageIds = pageRecords.map((r) => r.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default">
              <th className="px-3 py-2 w-[30px]">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={() => onSelectAllPage(pageIds, allOnPageSelected)}
                  aria-label={t("selectAll")}
                />
              </th>
              <th className="px-1 py-2 w-[24px]" />
              <SortHeader label={t("date")} sortKey="date" activeKey={sortKey} dir={sortDir} onClick={onSortChange} />
              <SortHeader label={t("drone")} sortKey="drone" activeKey={sortKey} dir={sortDir} onClick={onSortChange} />
              <SortHeader label={t("duration")} sortKey="duration" activeKey={sortKey} dir={sortDir} onClick={onSortChange} />
              <SortHeader label={t("distance")} sortKey="distance" activeKey={sortKey} dir={sortDir} onClick={onSortChange} />
              <SortHeader label={t("maxAlt")} sortKey="maxAlt" activeKey={sortKey} dir={sortDir} onClick={onSortChange} />
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("status")}
              </th>
              <SortHeader label={t("battUsed")} sortKey="battery" activeKey={sortKey} dir={sortDir} onClick={onSortChange} />
            </tr>
          </thead>
          <tbody>
            {pageRecords.map((rec) => {
              const checked = selectedIds.has(rec.id);
              return (
                <tr
                  key={rec.id}
                  onClick={() => onSelect(rec)}
                  className={cn(
                    "border-b border-border-default cursor-pointer transition-colors",
                    "hover:bg-bg-tertiary",
                    selectedId === rec.id && "bg-accent-primary/10",
                    checked && "bg-accent-primary/5",
                  )}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const ev = e.nativeEvent as MouseEvent;
                        onToggleSelect(rec.id, ev.shiftKey);
                      }}
                      aria-label={`Select ${rec.droneName}`}
                    />
                  </td>
                  <td className="px-1 py-2 text-center">
                    {rec.favorite && <Star size={12} className="inline text-accent-primary fill-current" />}
                  </td>
                  <td className="px-3 py-2 text-text-primary font-mono">
                    {rec.customName ? (
                      <span className="text-text-primary">{rec.customName}</span>
                    ) : (
                      formatDate(rec.startTime ?? rec.date)
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-primary">{rec.droneName}</td>
                  <td className="px-3 py-2 text-text-primary font-mono">
                    {formatDuration(rec.duration)}
                  </td>
                  <td className="px-3 py-2 text-text-primary font-mono">
                    {(rec.distance / 1000).toFixed(1)} km
                  </td>
                  <td className="px-3 py-2 text-text-primary font-mono">{rec.maxAlt}m</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant[rec.status] ?? "neutral"} size="sm">
                      {rec.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-text-primary font-mono">{rec.batteryUsed}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border-default shrink-0">
        <span className="text-[10px] text-text-tertiary font-mono">
          {t("recordsPageInfo", { from, to, total: records.length })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => p - 1)}
            icon={<ChevronLeft size={14} />}
          >
            {t("prev")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            icon={<ChevronRight size={14} />}
          >
            {t("next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
