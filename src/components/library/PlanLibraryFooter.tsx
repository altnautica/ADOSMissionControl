/**
 * @module PlanLibraryFooter
 * @description Footer bar with plan count, "From Drone" button, and import button.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Import, Download, Loader2 } from "lucide-react";

interface PlanLibraryFooterProps {
  count: number;
  onImport: () => void;
  onDownloadFromDrone?: () => void;
  isDownloading?: boolean;
  hasDrone?: boolean;
}

export function PlanLibraryFooter({ count, onImport, onDownloadFromDrone, isDownloading, hasDrone }: PlanLibraryFooterProps) {
  const t = useTranslations("library");
  return (
    <div className="px-3 py-1.5 border-t border-border-default flex items-center justify-between">
      <span className="text-[10px] text-text-tertiary">
        {t("planCount", { count })}
      </span>
      <div className="flex items-center gap-2">
        {onDownloadFromDrone && (
          <button
            onClick={onDownloadFromDrone}
            disabled={isDownloading || !hasDrone}
            className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title={!hasDrone ? t("connectDroneFirst") : t("loadFromDrone")}
          >
            {isDownloading ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
            {isDownloading ? t("loadingFromDrone") : t("fromDrone")}
          </button>
        )}
        <button
          onClick={onImport}
          className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          title={t("importPlanFile")}
        >
          <Import size={10} />
          {t("importShort")}
        </button>
      </div>
    </div>
  );
}
