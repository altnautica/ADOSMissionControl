"use client";

/**
 * Actionable error card for a failed flash: a plain-language title, the raw
 * error (collapsed/monospace), numbered recovery steps, a primary action
 * (retry / select device), and a manual-bootloader-entry guide. Driven by the
 * categorised remedy from {@link flash-error-map}.
 *
 * @module fc/firmware/FirmwareErrorRemedy
 */

import { AlertOctagon, RefreshCw, Usb } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FlashRemedy } from "./flash-error-map";

interface FirmwareErrorRemedyProps {
  remedy: FlashRemedy;
  message: string;
  onRetry?: () => void;
  onSelectBootloader?: () => void;
}

export function FirmwareErrorRemedy({
  remedy,
  message,
  onRetry,
  onSelectBootloader,
}: FirmwareErrorRemedyProps) {
  const t = useTranslations("flashTool.errors");
  const showRetry = remedy.primaryAction === "retry" || remedy.primaryAction === "retry-lower-baud";

  return (
    <div className="border border-status-error/40 bg-status-error/5 p-4 space-y-3" aria-live="assertive">
      <div className="flex items-start gap-2">
        <AlertOctagon size={16} className="text-status-error shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-status-error">{t(remedy.titleKey)}</p>
          {message && (
            <p className="text-[10px] text-text-tertiary font-mono mt-1 break-all">{message}</p>
          )}
        </div>
      </div>

      {remedy.stepKeys.length > 0 && (
        <ol className="list-decimal list-inside space-y-1 text-[10px] text-text-secondary ml-1">
          {remedy.stepKeys.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
      )}

      <div className="flex items-center gap-2">
        {remedy.primaryAction === "select-bootloader" && onSelectBootloader && (
          <button
            onClick={onSelectBootloader}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-accent-primary text-accent-foreground hover:bg-accent-primary/80 cursor-pointer transition-colors"
          >
            <Usb size={12} />
            {t("selectDevice")}
          </button>
        )}
        {showRetry && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold border border-accent-primary/50 text-accent-primary hover:bg-accent-primary/10 cursor-pointer transition-colors"
          >
            <RefreshCw size={12} />
            {t("retry")}
          </button>
        )}
      </div>

      {remedy.showManualBootloader && (
        <details className="text-[10px] text-text-tertiary">
          <summary className="cursor-pointer hover:text-text-secondary">{t("manualBootloader.summary")}</summary>
          <ol className="list-decimal list-inside space-y-1 ml-1 mt-2">
            <li>{t("manualBootloader.step1")}</li>
            <li>{t("manualBootloader.step2")}</li>
            <li>{t("manualBootloader.step3")}</li>
            <li>{t("manualBootloader.step4")}</li>
          </ol>
        </details>
      )}
    </div>
  );
}
