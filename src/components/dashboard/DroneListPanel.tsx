"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { DroneCard } from "@/components/shared/drone-card";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import { Plus, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { DroneTile } from "@/components/shared/drone-tile";

interface DroneListPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DroneListPanel({ collapsed, onToggleCollapse }: DroneListPanelProps) {
  const t = useTranslations("fleet");
  const drones = useFleetStore((s) => s.drones);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const selectDrone = useDroneManager((s) => s.selectDrone);

  const [search, setSearch] = useState("");
  const openDialog = useConnectDialogStore((s) => s.openDialog);

  const filtered = useMemo(() => {
    if (!search.trim()) return drones;
    const q = search.toLowerCase();
    return drones.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q) ||
        (d.suiteName && d.suiteName.toLowerCase().includes(q))
    );
  }, [drones, search]);

  if (collapsed) {
    return (
      <div className="w-12 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary">
        {/* Header: label + add + expand */}
        <div className="flex flex-col items-center gap-1.5 px-1 py-2 border-b border-border-default">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
            {t("title")}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); openDialog(); }}
            className="w-full aspect-square flex items-center justify-center bg-accent-primary/10 hover:bg-accent-primary transition-colors cursor-pointer group"
            title={t("addDrone")}
          >
            <Plus size={12} className="text-accent-primary group-hover:text-bg-primary transition-colors" />
          </button>
          <button
            onClick={onToggleCollapse}
            className="w-full aspect-square flex items-center justify-center hover:bg-bg-tertiary transition-colors cursor-pointer group"
            title={t("expandPanel")}
          >
            <ChevronRight size={12} className="text-text-tertiary group-hover:text-text-secondary transition-colors" />
          </button>
        </div>

        {/* Drone tiles */}
        <div className="flex-1 overflow-auto flex flex-col items-center gap-1 py-1.5">
          {drones.map((drone) => (
            <DroneTile
              key={drone.id}
              drone={drone}
              selected={drone.id === selectedDroneId}
              onClick={selectDrone}
            />
          ))}
        </div>

        {/* Count */}
        <div className="text-center py-1 border-t border-border-default">
          <span className="text-[9px] text-text-tertiary font-mono">{drones.length}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {t("title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={openDialog}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={onToggleCollapse}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
            title={t("collapsePanel")}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-default">
          <Search size={12} className="text-text-tertiary shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchDrones")}
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </div>
      </div>

      {/* Drone list */}
      <div className="flex-1 overflow-auto p-2 flex flex-col gap-2">
        {filtered.map((drone) => (
          <DroneCard
            key={drone.id}
            drone={drone}
            selected={drone.id === selectedDroneId}
            onClick={selectDrone}
          />
        ))}
        {filtered.length === 0 && (
          <div className="text-xs text-text-tertiary text-center py-4">
            {search ? t("noMatch") : t("noDrones")}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border-default">
        <span className="text-[10px] text-text-tertiary">
          {drones.length} {drones.length === 1 ? "drone" : "drones"}
        </span>
      </div>

    </div>
  );
}
