"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LayoutGrid, List, Map, Plus } from "lucide-react";

export type FleetViewMode = "grid" | "list" | "map";

interface FleetToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  suiteFilter: string;
  onSuiteFilterChange: (value: string) => void;
  sortBy: string;
  onSortChange: (value: string) => void;
  viewMode: FleetViewMode;
  onViewModeChange: (mode: FleetViewMode) => void;
  onAddDrone: () => void;
}

const viewModes: { mode: FleetViewMode; icon: typeof LayoutGrid }[] = [
  { mode: "grid", icon: LayoutGrid },
  { mode: "list", icon: List },
  { mode: "map", icon: Map },
];

export function FleetToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  suiteFilter,
  onSuiteFilterChange,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  onAddDrone,
}: FleetToolbarProps) {
  const t = useTranslations("fleet");

  const statusOptions = [
    { value: "all", label: t("toolbar.status.all") },
    { value: "online", label: t("toolbar.status.online") },
    { value: "in_mission", label: t("toolbar.status.inMission") },
    { value: "idle", label: t("toolbar.status.idle") },
    { value: "returning", label: t("toolbar.status.returning") },
    { value: "maintenance", label: t("toolbar.status.maintenance") },
    { value: "offline", label: t("toolbar.status.offline") },
  ];

  const suiteOptions = [
    { value: "all", label: t("toolbar.suite.all") },
    { value: "sentry", label: t("toolbar.suite.sentry") },
    { value: "survey", label: t("toolbar.suite.survey") },
    { value: "agriculture", label: t("toolbar.suite.agriculture") },
    { value: "cargo", label: t("toolbar.suite.cargo") },
    { value: "sar", label: t("toolbar.suite.sar") },
    { value: "inspection", label: t("toolbar.suite.inspection") },
  ];

  const sortOptions = [
    { value: "name", label: t("toolbar.sort.name") },
    { value: "status", label: t("toolbar.sort.status") },
    { value: "battery", label: t("toolbar.sort.battery") },
    { value: "health", label: t("toolbar.sort.health") },
  ];

  const viewModeLabels: Record<FleetViewMode, string> = {
    grid: t("toolbar.view.grid"),
    list: t("toolbar.view.list"),
    map: t("toolbar.view.map"),
  };

  return (
    <div className="flex flex-wrap items-end gap-2 p-3 border-b border-border-default bg-bg-secondary">
      <div className="w-48">
        <Input
          placeholder={t("searchDrones")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="w-36">
        <Select
          options={statusOptions}
          value={statusFilter}
          onChange={onStatusFilterChange}
        />
      </div>
      <div className="w-36">
        <Select
          options={suiteOptions}
          value={suiteFilter}
          onChange={onSuiteFilterChange}
        />
      </div>
      <div className="w-36">
        <Select
          options={sortOptions}
          value={sortBy}
          onChange={onSortChange}
        />
      </div>

      <div className="flex items-center border border-border-default">
        {viewModes.map(({ mode, icon: Icon }) => (
          <button
            key={mode}
            title={viewModeLabels[mode]}
            onClick={() => onViewModeChange(mode)}
            className={cn(
              "p-1.5 transition-colors cursor-pointer",
              viewMode === mode
                ? "bg-accent-primary text-white"
                : "text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary"
            )}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>

      <div className="ml-auto">
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={onAddDrone}
        >
          {t("addDrone")}
        </Button>
      </div>
    </div>
  );
}
