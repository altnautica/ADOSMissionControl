"use client";

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ManifestBoard } from "@/lib/protocol/firmware/types";
import type { SelectOptionGroup } from "@/lib/types";
import { HardDrive, Zap, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { VEHICLE_TYPES, versionLabel } from "./firmware-constants";
import { inferBoardMetadata } from "@/lib/boards";

interface Props {
  apBoards: ManifestBoard[];
  apLoading: boolean;
  apError: string;
  apVersions: string[];
  selectedApBoard: string;
  setSelectedApBoard: (v: string) => void;
  selectedVehicleType: string;
  setSelectedVehicleType: (v: string) => void;
  selectedApVersion: string;
  setSelectedApVersion: (v: string) => void;
  onRetry: () => void;
}

export function FirmwareArduPilotSection({
  apBoards, apLoading, apError, apVersions,
  selectedApBoard, setSelectedApBoard,
  selectedVehicleType, setSelectedVehicleType,
  selectedApVersion, setSelectedApVersion,
  onRetry,
}: Props) {
  const ol = useOptionLabels();
  const tr = useTranslations("fcPanels.firmwareArduPilotSection");
  const boardGroups = useMemo((): SelectOptionGroup[] => {
    if (apBoards.length === 0) return []

    const grouped = new Map<string, { name: string; mcu: string }[]>()

    for (const board of apBoards) {
      const meta = inferBoardMetadata(board.name)
      const vendor = meta.vendor
      const mcu = meta.mcu

      const list = grouped.get(vendor) ?? []
      list.push({ name: board.name, mcu })
      grouped.set(vendor, list)
    }

    const groups: SelectOptionGroup[] = []
    const sortedVendors = Array.from(grouped.keys()).sort()

    for (const vendor of sortedVendors) {
      const boards = grouped.get(vendor) ?? []
      groups.push({
        label: vendor,
        options: boards
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((b) => ({
            value: b.name,
            label: b.name,
            description: b.mcu !== 'Unknown' ? b.mcu : undefined,
          })),
      })
    }

    return groups
  }, [apBoards])

  return (
    <>
      <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
            <HardDrive size={14} />
            {tr("targetBoard")}
          </h2>
          {apLoading && (
            <span className="text-[10px] text-text-tertiary flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" /> {tr("loadingManifest")}
            </span>
          )}
        </div>

        {apError && (
          <div className="text-[10px] text-status-error flex items-center justify-between">
            <span>{apError}</span>
            <button onClick={onRetry} className="underline cursor-pointer">{tr("retry")}</button>
          </div>
        )}

        <Select
          value={selectedApBoard}
          onChange={setSelectedApBoard}
          disabled={apLoading || apBoards.length === 0}
          placeholder={tr("loadingBoards")}
          searchable
          options={boardGroups.length > 0 ? boardGroups : apBoards.map((b) => ({ value: b.name, label: b.name }))}
        />
        <p className="text-[10px] text-text-tertiary">{apBoards.length} boards available from ArduPilot manifest</p>
      </div>

      <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
        <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
          <Zap size={14} />
          {tr("firmwareVersion")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label={tr("vehicleType")}
            value={selectedVehicleType}
            onChange={setSelectedVehicleType}
            options={ol(VEHICLE_TYPES)}
          />
          <Select
            label={tr("version")}
            value={selectedApVersion}
            onChange={setSelectedApVersion}
            disabled={apVersions.length === 0}
            placeholder={apLoading ? "Loading..." : selectedApBoard ? "No versions found" : "Select board first"}
            searchable
            options={apVersions.map((v) => ({ value: v, label: versionLabel(v) }))}
          />
        </div>
      </div>
    </>
  );
}
