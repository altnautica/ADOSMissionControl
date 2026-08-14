"use client";

/**
 * @module vision/TargetActionPopup
 * @description The popup shown when the operator clicks a detection in the
 * cockpit overlay. Lists every target-action applicable to the selected target
 * — built-in host actions AND plugin-contributed ones, in one list — and runs
 * the picked one on that target. This is the cross-plugin "what can I do with
 * this target" surface.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/ui/toast";
import {
  resolveTargetActions,
  type TargetAction,
} from "@/lib/skills/target-actions";
import type { SelectedTarget } from "@/stores/selected-target-store";

export function TargetActionPopup({
  target,
  onClose,
}: {
  target: SelectedTarget;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const t = useTranslations("vision");
  const [busy, setBusy] = useState<string | null>(null);
  const actions = resolveTargetActions(target);

  const run = async (action: TargetAction) => {
    if (busy) return;
    setBusy(action.id);
    try {
      await action.activate({
        target,
        notify: (message, status) => toast(message, status ?? "info"),
      });
    } finally {
      setBusy(null);
      onClose();
    }
  };

  const title =
    target.trackId != null
      ? `${target.classLabel || "target"} #${target.trackId}`
      : target.classLabel || "target";

  return (
    <div
      data-target-interactive
      className="pointer-events-auto min-w-[168px] rounded border border-border-default bg-bg-secondary/95 shadow-lg backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border-default px-2.5 py-1.5">
        <span className="truncate font-mono text-[10px] uppercase tracking-wide text-text-secondary">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("targetActions.dismiss")}
          className="text-text-tertiary hover:text-text-primary"
        >
          ×
        </button>
      </div>
      {actions.length === 0 ? (
        <div className="px-2.5 py-2 text-[11px] text-text-tertiary">
          {t("targetActions.none")}
        </div>
      ) : (
        <div className="p-1">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(a)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
            >
              {a.icon ? (
                <a.icon className="h-3.5 w-3.5 shrink-0 text-accent-primary" />
              ) : null}
              <span className="flex-1 truncate">{a.label}</span>
              {a.source === "plugin" ? (
                <span className="rounded bg-bg-tertiary px-1 text-[9px] uppercase tracking-wide text-text-tertiary">
                  {t("targetActions.pluginBadge")}
                </span>
              ) : null}
              {a.defaultKey ? (
                <kbd className="rounded border border-border-default bg-bg-tertiary px-1 font-mono text-[9px] uppercase text-text-secondary">
                  {a.defaultKey}
                </kbd>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
