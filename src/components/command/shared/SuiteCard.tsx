"use client";

/**
 * @module SuiteCard
 * @description Card component for displaying an ADOS suite with install/activate controls.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import {
  Shield,
  Map,
  Search,
  Sprout,
  PackageCheck,
  LifeBuoy,
  Download,
  Check,
  Zap,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SuiteInfo } from "@/lib/agent/types";
import { useState } from "react";

const iconMap: Record<string, typeof Shield> = {
  Shield,
  Map,
  Search,
  Sprout,
  PackageCheck,
  LifeBuoy,
};

const categoryColors: Record<string, string> = {
  security: "text-status-error",
  mapping: "text-accent-primary",
  agriculture: "text-status-success",
  logistics: "text-status-warning",
  rescue: "text-status-error",
  inspection: "text-accent-primary",
};

interface SuiteCardProps {
  suite: SuiteInfo;
  onInstall: (id: string) => Promise<void>;
  onActivate: (id: string) => Promise<void>;
}

export function SuiteCard({ suite, onInstall, onActivate }: SuiteCardProps) {
  const t = useTranslations("moduleStore");
  const [loading, setLoading] = useState(false);
  const Icon = iconMap[suite.icon] ?? Shield;

  async function handleAction() {
    setLoading(true);
    try {
      if (!suite.installed) {
        await onInstall(suite.id);
      } else if (!suite.active) {
        await onActivate(suite.id);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={cn(
        "border rounded-lg p-4 bg-bg-secondary transition-colors",
        suite.active
          ? "border-accent-primary"
          : "border-border-default"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "p-2 rounded-lg bg-bg-tertiary",
            categoryColors[suite.category] ?? "text-text-secondary"
          )}
        >
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-text-primary">
              {suite.name}
            </h4>
            <span className="text-[10px] font-mono text-text-tertiary">
              v{suite.version}
            </span>
            {suite.active && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-primary/15 text-accent-primary">
                <Zap size={8} />
                {t("active")}
              </span>
            )}
          </div>
          <p className="text-xs text-text-tertiary mt-1 line-clamp-2">
            {suite.description}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1 flex-wrap">
          {suite.sensorsRequired.map((s) => (
            <span
              key={s}
              className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-tertiary"
            >
              {s}
            </span>
          ))}
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-tertiary">
            Tier {suite.tierRequired}+
          </span>
        </div>

        {suite.active ? (
          <span className="flex items-center gap-1 px-2 py-1 text-xs text-status-success">
            <Check size={12} />
            {t("active")}
          </span>
        ) : (
          <button
            onClick={handleAction}
            disabled={loading}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors",
              suite.installed
                ? "bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25"
                : "bg-accent-primary text-white hover:opacity-90"
            )}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : suite.installed ? (
              <Zap size={12} />
            ) : (
              <Download size={12} />
            )}
            {suite.installed ? t("activate") : t("install")}
          </button>
        )}
      </div>
    </div>
  );
}
