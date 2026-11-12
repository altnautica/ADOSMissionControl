/**
 * @module PreflightChecklist
 * @description Mission prep checklist for the mission planner (shown as
 * "Mission prep checklist"; it is not the flight screen's pre-flight gate).
 * Renders the default checklist grouped by category with a per-item toggle and
 * a running progress count. The operator ticks items off before uploading.
 *
 * Ticks live in `usePreflightChecklistStore` (session-only, not persisted) so
 * they survive the dock collapsing or switching tabs. All checklist logic lives
 * in the pure `preflight-checklist` module; this file is presentation only.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CheckSquare, Square, CheckCircle2 } from "lucide-react";
import {
  DEFAULT_CHECKLIST,
  checklistProgress,
  groupByCategory,
} from "@/lib/preflight-checklist";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";

export function PreflightChecklist() {
  const t = useTranslations("planner.checklist");
  const checked = usePreflightChecklistStore((s) => s.checked);
  const toggle = usePreflightChecklistStore((s) => s.toggle);
  const clear = usePreflightChecklistStore((s) => s.clear);

  const progress = useMemo(() => checklistProgress(DEFAULT_CHECKLIST, checked), [checked]);
  const groups = useMemo(() => groupByCategory(DEFAULT_CHECKLIST), []);

  return (
    <div className="flex flex-col gap-2 text-xs">
      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 rounded bg-bg-tertiary overflow-hidden">
          <div
            className={`h-full transition-[width] ${
              progress.complete ? "bg-status-success" : "bg-accent-primary"
            }`}
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </div>
        {progress.complete ? (
          <span className="flex items-center gap-1 text-[11px] text-status-success">
            <CheckCircle2 size={11} />
            {t("ready")}
          </span>
        ) : (
          <span className="text-[11px] font-mono text-text-secondary tabular-nums">
            {t("progress", { checked: progress.checked, total: progress.total })}
          </span>
        )}
        <button
          type="button"
          onClick={clear}
          disabled={progress.checked === 0}
          className="text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-default cursor-pointer transition-colors"
        >
          {t("clear")}
        </button>
      </div>

      {/* Grouped items */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-2">
        {groups.map((group) => (
          <div key={group.category} className="flex flex-col gap-0.5">
            <span className="font-body text-[11px] font-semibold text-text-tertiary px-0.5">
              {t(`category.${group.category}`)}
            </span>
            {group.items.map((item) => {
              const isChecked = !!checked[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-pressed={isChecked}
                  className="flex items-center gap-2 px-1.5 py-1 text-left rounded hover:bg-bg-tertiary transition-colors cursor-pointer"
                >
                  {isChecked ? (
                    <CheckSquare size={13} className="shrink-0 text-status-success" />
                  ) : (
                    <Square size={13} className="shrink-0 text-text-tertiary" />
                  )}
                  <span
                    className={`text-xs ${
                      isChecked ? "text-text-tertiary line-through" : "text-text-secondary"
                    }`}
                  >
                    {t(item.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
