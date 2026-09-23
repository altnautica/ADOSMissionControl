"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { HardDrive, Zap, RefreshCw } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { SelectOptionGroup } from "@/lib/types";
import {
  groupBoardsByVendor,
  type BoardManifest,
} from "@/lib/protocol/firmware/ap-periph-manifest";

interface Props {
  boards: readonly string[];
  channels: readonly string[];
  selectedBoard: string;
  setSelectedBoard: (board: string) => void;
  selectedChannel: string;
  setSelectedChannel: (channel: string) => void;
  manifest: BoardManifest | null;
  loading: boolean;
  error: string;
  currentNodeVersion?: string;
  onRetry: () => void;
}

export function FirmwareApPeriphFirmwareCard({
  boards,
  channels,
  selectedBoard,
  setSelectedBoard,
  selectedChannel,
  setSelectedChannel,
  manifest,
  loading,
  error,
  currentNodeVersion,
  onRetry,
}: Props) {
  const t = useTranslations("flashTool.apPeriph");

  const boardGroups = useMemo((): SelectOptionGroup[] => {
    if (boards.length === 0) return [];
    const grouped = groupBoardsByVendor(boards);
    const out: SelectOptionGroup[] = [];
    for (const vendor of Array.from(grouped.keys()).sort()) {
      const list = grouped.get(vendor) ?? [];
      out.push({
        label: vendor,
        options: list.map((b) => ({ value: b, label: b })),
      });
    }
    return out;
  }, [boards]);

  const appFile = manifest?.files.find((f) => f.kind === "app") ?? null;
  const sizeKb = appFile?.sizeBytes != null
    ? `${(appFile.sizeBytes / 1024).toFixed(1)} KB`
    : null;

  const diffLabel = useMemo(() => {
    if (!manifest?.version || !currentNodeVersion) return null;
    if (manifest.version === currentNodeVersion) return t("firmware.diff.sameVersion");
    return t("firmware.diff.newerAvailable", {
      current: currentNodeVersion,
      next: manifest.version,
    });
  }, [manifest, currentNodeVersion, t]);

  return (
    <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
          <Zap size={14} />
          {t("firmware.title")}
        </h2>
        {loading && (
          <span className="text-[10px] text-text-tertiary flex items-center gap-1">
            <RefreshCw size={10} className="animate-spin" /> {t("firmware.loading")}
          </span>
        )}
      </div>

      {error && (
        <div className="text-[10px] text-status-error flex items-center justify-between">
          <span>{error}</span>
          <button onClick={onRetry} className="underline cursor-pointer">
            {t("firmware.retry")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] text-text-tertiary uppercase flex items-center gap-1.5">
            <HardDrive size={10} />
            {t("firmware.board")}
          </label>
          <Select
            value={selectedBoard}
            onChange={setSelectedBoard}
            disabled={loading || boards.length === 0}
            placeholder={loading ? t("firmware.loading") : t("firmware.boardPlaceholder")}
            searchable
            options={
              boardGroups.length > 0
                ? boardGroups
                : boards.map((b) => ({ value: b, label: b }))
            }
          />
        </div>
        <Select
          label={t("firmware.channel")}
          value={selectedChannel}
          onChange={setSelectedChannel}
          disabled={loading || channels.length === 0}
          placeholder={t("firmware.channelPlaceholder")}
          options={channels.map((c) => ({ value: c, label: c }))}
        />
      </div>

      {manifest && (
        <div className="bg-bg-tertiary border border-border-default p-3 space-y-1 text-[10px] text-text-secondary font-mono">
          {manifest.version && (
            <p>
              <span className="text-text-tertiary">{t("firmware.version")}:</span> {manifest.version}
            </p>
          )}
          {sizeKb && (
            <p>
              <span className="text-text-tertiary">{t("firmware.size")}:</span> {sizeKb}
            </p>
          )}
          {appFile && (
            <p className="truncate">
              <span className="text-text-tertiary">{t("firmware.source")}:</span> {appFile.url}
            </p>
          )}
          {diffLabel && (
            <p className="text-accent-primary">
              {diffLabel}
            </p>
          )}
          {currentNodeVersion && !manifest.version && (
            <p className="text-text-tertiary">
              {t("firmware.diff.bootloaderOnly", { current: currentNodeVersion })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
