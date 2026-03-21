"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { RefreshCw, Download, Loader2, AlertCircle, AlertTriangle } from "lucide-react";

interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  loading: boolean;
  loadProgress: { loaded: number; total: number } | null;
  hasLoaded: boolean;
  onRead: () => void;
  connected: boolean;
  error: string | null;
  /** Optional params that were not found on this firmware */
  missingOptional?: Set<string>;
  /** Extra elements rendered to the right of the action buttons */
  children?: ReactNode;
}

export function PanelHeader({
  title,
  subtitle,
  icon,
  loading,
  loadProgress,
  hasLoaded,
  onRead,
  connected,
  error,
  missingOptional,
  children,
}: PanelHeaderProps) {
  const t = useTranslations("fcShared");
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-accent-primary shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h1 className="text-lg font-display font-semibold text-text-primary">{title}</h1>
          {subtitle && (
            <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Inline loading progress */}
        {loading && loadProgress && (
          <div className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin text-accent-primary" />
            <span className="text-[10px] font-mono text-text-secondary">
              {loadProgress.loaded}/{loadProgress.total}
            </span>
          </div>
        )}

        {/* Inline error badge */}
        {error && !loading && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-status-error/10 border border-status-error/20">
            <AlertCircle size={10} className="text-status-error shrink-0" />
            <span className="text-[10px] text-status-error max-w-[200px] truncate">{error}</span>
          </div>
        )}

        {/* Optional params warning badge */}
        {missingOptional && missingOptional.size > 0 && !loading && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-status-warning/10 border border-status-warning/20">
            <AlertTriangle size={10} className="text-status-warning shrink-0" />
            <span className="text-[10px] text-status-warning max-w-[200px] truncate">
              {t("missingParams")}
            </span>
          </div>
        )}

        {/* Read from FC / Retry / Refresh button */}
        {connected && !loading && !hasLoaded && !error && (
          <Button
            variant="primary"
            size="sm"
            icon={<Download size={12} />}
            onClick={onRead}
          >
            {t("readFromFc")}
          </Button>
        )}
        {connected && !loading && !hasLoaded && error && (
          <Button
            variant="primary"
            size="sm"
            icon={<Download size={12} />}
            onClick={onRead}
          >
            {t("retry")}
          </Button>
        )}
        {connected && !loading && hasLoaded && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={12} />}
            onClick={onRead}
          >
            {t("refresh")}
          </Button>
        )}

        {children}
      </div>
    </div>
  );
}
