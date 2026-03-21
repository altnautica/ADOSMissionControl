"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download } from "lucide-react";
import type { FlightRecord } from "@/lib/types";
import { exportFlightRecordsAsCsv } from "@/lib/csv-export";

interface HistoryToolbarProps {
  dateFrom: string;
  dateTo: string;
  status: string;
  droneFilter: string;
  suiteFilter: string;
  sort: string;
  droneNames: { value: string; label: string }[];
  records: FlightRecord[];
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onDroneFilterChange: (v: string) => void;
  onSuiteFilterChange: (v: string) => void;
  onSortChange: (v: string) => void;
}

export function HistoryToolbar({
  dateFrom,
  dateTo,
  status,
  droneFilter,
  suiteFilter,
  sort,
  droneNames,
  records,
  onDateFromChange,
  onDateToChange,
  onStatusChange,
  onDroneFilterChange,
  onSuiteFilterChange,
  onSortChange,
}: HistoryToolbarProps) {
  const t = useTranslations("history");

  const STATUS_OPTIONS = useMemo(() => [
    { value: "all", label: t("allStatuses") },
    { value: "completed", label: t("completed") },
    { value: "aborted", label: t("aborted") },
    { value: "emergency", label: t("emergency") },
  ], [t]);

  const SORT_OPTIONS = useMemo(() => [
    { value: "date-desc", label: t("newestFirst") },
    { value: "date-asc", label: t("oldestFirst") },
    { value: "duration-desc", label: t("longest") },
    { value: "distance-desc", label: t("farthest") },
  ], [t]);

  const SUITE_OPTIONS = useMemo(() => [
    { value: "all", label: t("allSuites") },
    { value: "sentry", label: "Sentry" },
    { value: "survey", label: "Survey" },
    { value: "agriculture", label: "Agriculture" },
    { value: "cargo", label: "Cargo" },
    { value: "sar", label: "SAR" },
    { value: "inspection", label: "Inspection" },
  ], [t]);

  const allDroneOptions = [{ value: "all", label: t("allDrones") }, ...droneNames];

  return (
    <div className="flex items-end gap-3 px-4 py-3 border-b border-border-default flex-wrap shrink-0">
      <Input
        label={t("from")}
        type="date"
        value={dateFrom}
        onChange={(e) => onDateFromChange(e.target.value)}
        className="w-[130px]"
      />
      <Input
        label={t("to")}
        type="date"
        value={dateTo}
        onChange={(e) => onDateToChange(e.target.value)}
        className="w-[130px]"
      />
      <Select
        label={t("statusLabel")}
        options={STATUS_OPTIONS}
        value={status}
        onChange={onStatusChange}
      />
      <Select
        label={t("droneLabel")}
        options={allDroneOptions}
        value={droneFilter}
        onChange={onDroneFilterChange}
      />
      <Select
        label={t("suiteLabel")}
        options={SUITE_OPTIONS}
        value={suiteFilter}
        onChange={onSuiteFilterChange}
      />
      <Select
        label="Sort"
        options={SORT_OPTIONS}
        value={sort}
        onChange={onSortChange}
      />
      <Button
        variant="secondary"
        size="md"
        icon={<Download size={14} />}
        onClick={() => exportFlightRecordsAsCsv(records)}
      >
        Export
      </Button>
    </div>
  );
}
