"use client";

import { useTranslations } from "next-intl";
import { RotateCcw, Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Tooltip } from "@/components/ui/tooltip";
import { useChecklistStore } from "@/stores/checklist-store";
import { useDroneManager } from "@/stores/drone-manager";
import { cn } from "@/lib/utils";
import { CATEGORY_ORDER, CATEGORY_LABEL_KEYS, ChecklistRow } from "./checklist-helpers";

/**
 * The checklist for the selected drone. Auto items are kept current by
 * `ChecklistAutoRunner` (mounted by the shell), so what this shows, and what
 * the Arm and Take-off confirms read, does not depend on this view being open.
 */
export function PreFlightChecklist({ className }: { className?: string }) {
  const t = useTranslations("checklist");
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const items = useChecklistStore((s) => s.items);
  const startSession = useChecklistStore((s) => s.startSession);
  const isReadyToArm = useChecklistStore((s) => s.isReadyToArm);
  const getProgress = useChecklistStore((s) => s.getProgress);
  const getCategoryProgress = useChecklistStore((s) => s.getCategoryProgress);

  const progress = getProgress();
  const progressPct = progress.total > 0 ? (progress.checked / progress.total) * 100 : 0;
  const ready = isReadyToArm(selectedId);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <Shield size={14} className="text-text-secondary shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex-1">
          Pre-Flight Checklist
        </span>
        <Tooltip content="Reset all checks" position="left">
          <Button
            size="sm"
            variant="ghost"
            disabled={!selectedId}
            onClick={() => {
              if (selectedId) startSession(selectedId);
            }}
          >
            <RotateCcw size={10} />
          </Button>
        </Tooltip>
      </div>

      {/* Progress bar */}
      <div className="px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono text-text-tertiary">
            {progress.checked}/{progress.total} items
          </span>
          {progress.failed > 0 && (
            <span className="text-[10px] font-mono text-status-error">
              {progress.failed} failed
            </span>
          )}
        </div>
        <ProgressBar
          value={progressPct}
          color={
            progress.failed > 0
              ? "var(--alt-status-error)"
              : progressPct === 100
                ? "var(--alt-status-success)"
                : "var(--alt-accent-primary)"
          }
        />
      </div>

      {/* Category sections */}
      <div className="flex-1 overflow-y-auto">
        {CATEGORY_ORDER.map((category) => {
          const catItems = items.filter((i) => i.category === category);
          const catProgress = getCategoryProgress(category);
          return (
            <CollapsibleSection
              key={category}
              title={t(CATEGORY_LABEL_KEYS[category])}
              defaultOpen
              count={catProgress.checked}
              trailing={
                <span className="text-[9px] font-mono text-text-tertiary">
                  {catProgress.checked}/{catProgress.total}
                </span>
              }
            >
              <div className="pb-1">
                {catItems.map((item) => (
                  <ChecklistRow key={item.id} item={item} />
                ))}
              </div>
            </CollapsibleSection>
          );
        })}
      </div>

      {/* Ready to arm indicator */}
      <div
        className={cn(
          "mx-3 mb-3 mt-2 px-3 py-2 border flex items-center gap-2",
          ready
            ? "bg-status-success/10 border-status-success/30"
            : "bg-status-warning/10 border-status-warning/30",
        )}
      >
        {ready ? (
          <ShieldCheck size={16} className="text-status-success shrink-0" />
        ) : (
          <ShieldAlert size={16} className="text-status-warning shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "text-xs font-semibold",
              ready ? "text-status-success" : "text-status-warning",
            )}
          >
            {ready ? "READY TO ARM" : "NOT READY"}
          </span>
          {!ready && (
            <p className="text-[10px] text-text-tertiary mt-0.5">
              {progress.total - progress.checked} item{progress.total - progress.checked !== 1 ? "s" : ""} remaining
              {progress.failed > 0 && `, ${progress.failed} failed`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
