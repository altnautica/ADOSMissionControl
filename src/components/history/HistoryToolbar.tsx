"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Star, X, HardDrive, Upload } from "lucide-react";
import type { FlightRecord } from "@/lib/types";
import { exportFlightRecordsAsCsv } from "@/lib/csv-export";
import { CloudSyncBadge } from "./CloudSyncBadge";
import { LogBrowser } from "./dataflash/LogBrowser";
import { UploadLog } from "./dataflash/UploadLog";

export type DatePreset = "all" | "today" | "7d" | "30d" | "month";

interface HistoryToolbarProps {
  search: string;
  dateFrom: string;
  dateTo: string;
  datePreset: DatePreset;
  status: string;
  droneFilter: string;
  suiteFilter: string;
  sort: string;
  favoritesOnly: boolean;
  droneNames: { value: string; label: string }[];
  records: FlightRecord[];
  onSearchChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onDatePresetChange: (v: DatePreset) => void;
  onStatusChange: (v: string) => void;
  onDroneFilterChange: (v: string) => void;
  onSuiteFilterChange: (v: string) => void;
  onSortChange: (v: string) => void;
  onFavoritesOnlyChange: (v: boolean) => void;
  onReset: () => void;
}

export function HistoryToolbar({
  search,
  dateFrom,
  dateTo,
  datePreset,
  status,
  droneFilter,
  suiteFilter,
  sort,
  favoritesOnly,
  droneNames,
  records,
  onSearchChange,
  onDateFromChange,
  onDateToChange,
  onDatePresetChange,
  onStatusChange,
  onDroneFilterChange,
  onSuiteFilterChange,
  onSortChange,
  onFavoritesOnlyChange,
  onReset,
}: HistoryToolbarProps) {
  const t = useTranslations("history");
  const [logBrowserOpen, setLogBrowserOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const STATUS_OPTIONS = useMemo(() => [
    { value: "all", label: t("allStatuses") },
    { value: "in_progress", label: t("inProgress") },
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

  const PRESET_OPTIONS = useMemo(() => [
    { value: "all", label: t("presetAll") },
    { value: "today", label: t("presetToday") },
    { value: "7d", label: t("preset7d") },
    { value: "30d", label: t("preset30d") },
    { value: "month", label: t("presetMonth") },
  ], [t]);

  const allDroneOptions = [{ value: "all", label: t("allDrones") }, ...droneNames];

  return (
    <div className="flex items-end gap-3 px-4 py-3 border-b border-border-default flex-wrap shrink-0">
      <Input
        label={t("search")}
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t("searchPlaceholder")}
        className="w-[220px]"
      />
      <Select
        label={t("datePresetLabel")}
        options={PRESET_OPTIONS}
        value={datePreset}
        onChange={(v) => onDatePresetChange(v as DatePreset)}
      />
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
        label={t("sortLabel")}
        options={SORT_OPTIONS}
        value={sort}
        onChange={onSortChange}
      />
      <Button
        variant={favoritesOnly ? "primary" : "secondary"}
        size="md"
        icon={<Star size={14} />}
        onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
        title={t("favoritesOnly")}
      >
        {t("favoritesOnly")}
      </Button>
      <Button
        variant="secondary"
        size="md"
        icon={<Download size={14} />}
        onClick={() => exportFlightRecordsAsCsv(records)}
      >
        {t("exportBtn")}
      </Button>
      <Button
        variant="ghost"
        size="md"
        icon={<X size={14} />}
        onClick={onReset}
      >
        {t("reset")}
      </Button>
      <Button
        variant="secondary"
        size="md"
        icon={<HardDrive size={14} />}
        onClick={() => setLogBrowserOpen(true)}
        title={t("onboardLogs")}
      >
        {t("onboardLogs")}
      </Button>
      <Button
        variant="secondary"
        size="md"
        icon={<Upload size={14} />}
        onClick={() => setUploadOpen(true)}
        title={t("importBin")}
      >
        {t("importBin")}
      </Button>
      <CloudSyncBadge />

      <LogBrowser open={logBrowserOpen} onClose={() => setLogBrowserOpen(false)} />
      <UploadLog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
