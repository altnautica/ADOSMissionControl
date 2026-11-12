"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { PX4Release, PX4Board } from "@/lib/protocol/firmware/types";
import { HardDrive, Zap, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import { buildPX4SelectGroups } from "@/lib/boards";

interface Props {
  px4Releases: PX4Release[];
  px4Loading: boolean;
  px4Error: string;
  selectedPx4Release: string;
  setSelectedPx4Release: (v: string) => void;
  selectedPx4Board: string;
  setSelectedPx4Board: (v: string) => void;
  px4Boards: PX4Board[];
  onRetry: () => void;
}

export function FirmwarePx4Section({
  px4Releases, px4Loading, px4Error,
  selectedPx4Release, setSelectedPx4Release,
  selectedPx4Board, setSelectedPx4Board,
  px4Boards, onRetry,
}: Props) {
  const tr = useTranslations("fcPanels.firmwarePx4Section");
  const boardGroups = useMemo(() => buildPX4SelectGroups(px4Boards), [px4Boards])

  return (
    <>
      <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
            <Zap size={14} />
            {tr("px4Release")}
          </h2>
          {px4Loading && (
            <span className="text-[10px] text-text-tertiary flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" /> {tr("loadingReleases")}
            </span>
          )}
        </div>

        {px4Error && (
          <div className="text-[10px] text-status-error flex items-center justify-between">
            <span>{px4Error}</span>
            <button onClick={onRetry} className="underline cursor-pointer">{tr("retry")}</button>
          </div>
        )}

        <Select
          label={tr("release")}
          value={selectedPx4Release}
          onChange={(v) => { setSelectedPx4Release(v); setSelectedPx4Board(""); }}
          disabled={px4Loading || px4Releases.length === 0}
          placeholder={tr("loadingReleases")}
          options={px4Releases.map((r) => ({
            value: r.tag,
            label: `${r.name || r.tag}${r.prerelease ? " (pre-release)" : ""}`,
          }))}
        />
      </div>

      <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
        <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
          <HardDrive size={14} />
          {tr("targetBoard")}
        </h2>
        <Select
          value={selectedPx4Board}
          onChange={setSelectedPx4Board}
          disabled={px4Boards.length === 0}
          placeholder={selectedPx4Release ? (px4Boards.length === 0 ? "No boards in this release" : "Select board...") : "Select release first"}
          searchable
          options={boardGroups.length > 0 ? boardGroups : px4Boards.map((b) => ({
            value: b.name,
            label: b.displayName,
            description: `${(b.size / 1024 / 1024).toFixed(1)} MB`,
          }))}
        />
        {px4Boards.length > 0 && (
          <p className="text-[10px] text-text-tertiary">{px4Boards.length} boards in {selectedPx4Release}</p>
        )}
      </div>
    </>
  );
}
