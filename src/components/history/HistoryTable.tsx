"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatDate, formatDuration } from "@/lib/utils";
import type { FlightRecord } from "@/lib/types";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 20;

const statusVariant: Record<string, "success" | "warning" | "error"> = {
  completed: "success",
  aborted: "warning",
  emergency: "error",
};

interface HistoryTableProps {
  records: FlightRecord[];
  selectedId: string | null;
  onSelect: (record: FlightRecord) => void;
}

export function HistoryTable({ records, selectedId, onSelect }: HistoryTableProps) {
  const t = useTranslations("history");
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(records.length / PAGE_SIZE);
  const pageRecords = records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default">
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("date")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("drone")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("duration")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("distance")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("maxAlt")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("status")}
              </th>
              <th className="px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider">
                {t("battUsed")}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRecords.map((rec) => (
              <tr
                key={rec.id}
                onClick={() => onSelect(rec)}
                className={cn(
                  "border-b border-border-default cursor-pointer transition-colors",
                  "hover:bg-bg-tertiary",
                  selectedId === rec.id && "bg-accent-primary/10"
                )}
              >
                <td className="px-3 py-2 text-text-primary font-mono">
                  {formatDate(rec.date)}
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
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border-default shrink-0">
        <span className="text-[10px] text-text-tertiary font-mono">
          {t("recordsPageInfo", { records: records.length, page: page + 1, totalPages })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            icon={<ChevronLeft size={14} />}
          >
            {t("prev")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages - 1}
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
