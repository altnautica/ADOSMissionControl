"use client";

import { useTranslations } from "next-intl";
import { Download, CheckCircle2, Cpu, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FilteredModel } from "@/lib/vision/model-filter";
import {
  TERMINAL_STATES,
  fitLabel,
  type DownloadState,
  type PickerMode,
} from "./model-picker-labels";

interface ModelPickerRowsProps {
  models: FilteredModel[];
  mode: PickerMode;
  downloads: Record<string, DownloadState>;
  settingActive: string | null;
  isHardBlocked: boolean;
  hardBlockMessage: string;
  startDownload: (modelId: string) => void;
  setActive: (modelId: string) => void;
}

/** One row per model: badges, then download progress or the set-active control. */
export function ModelPickerRows({
  models,
  mode,
  downloads,
  settingActive,
  isHardBlocked,
  hardBlockMessage,
  startDownload,
  setActive,
}: ModelPickerRowsProps) {
  const t = useTranslations("vision");
  return (
  <ul className={cn("flex flex-col", mode === "compact" ? "gap-1.5" : "gap-2")}>
    {models.map((model) => {
      const dl = downloads[model.id];
      const downloading = dl != null && !TERMINAL_STATES.has(dl.state);
      const isSettingActive = settingActive === model.id;
      return (
        <li
          key={model.id}
          className={cn(
            "flex items-center gap-3 rounded border bg-bg-tertiary px-3 py-2",
            model.active
              ? "border-accent-primary/60"
              : "border-border-default",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-xs font-medium text-text-primary">
                {model.name}
              </span>
              {model.active ? (
                <Badge variant="success" size="sm">
                  <span className="inline-flex items-center gap-1">
                    <Crosshair className="h-2.5 w-2.5" />
                    {t("activeBadge")}
                  </span>
                </Badge>
              ) : null}
              {model.custom ? (
                <Badge variant="info" size="sm">
                  {t("customBadge")}
                </Badge>
              ) : null}
              {model.task ? (
                <span className="rounded border border-border-default px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
                  {model.task}
                </span>
              ) : null}
              {!model.fits ? (
                <Badge variant="warning" size="sm">
                  <span className="inline-flex items-center gap-1">
                    <Cpu className="h-2.5 w-2.5" />
                    {fitLabel(model.fitReason)}
                  </span>
                </Badge>
              ) : null}
              {model.custom && model.customMeta && !model.customMeta.verified ? (
                <Badge variant="warning" size="sm">
                  {t("unverifiedBadge")}
                </Badge>
              ) : null}
              {model.benchmarkOnly ? (
                <span title={t("benchmarkOnlyHint")}>
                  <Badge variant="neutral" size="sm">
                    {t("benchmarkOnly")}
                  </Badge>
                </span>
              ) : null}
            </div>
            {mode === "full" && model.description ? (
              <p className="truncate text-[11px] text-text-tertiary">
                {model.description}
              </p>
            ) : null}
            {mode === "full" &&
            model.custom &&
            model.customMeta &&
            model.customMeta.classes.length > 0 ? (
              <p className="truncate text-[11px] text-text-tertiary">
                {t("classesLine", {
                  classes: model.customMeta.classes.join(", "),
                })}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!model.installed ? (
              downloading ? (
                <span className="font-mono text-[11px] text-accent-primary">
                  {dl.state === "verifying"
                    ? t("verifying")
                    : `${Math.round(dl.percent)}%`}
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={13} />}
                  onClick={() => startDownload(model.id)}
                >
                  {t("download")}
                </Button>
              )
            ) : model.active ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-status-success">
                <CheckCircle2 size={13} />
                {t("activeBadge")}
              </span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setActive(model.id)}
                loading={isSettingActive}
                disabled={settingActive !== null || isHardBlocked}
                title={isHardBlocked ? hardBlockMessage : undefined}
              >
                {t("setActive")}
              </Button>
            )}
          </div>
        </li>
      );
    })}
  </ul>
  );
}
