/**
 * @module PlanTreeItem
 * @description Individual plan card in the library tree.
 * Shows name, waypoint count, distance, relative time. Active highlight + dirty dot.
 * Hover reveals save button (active+dirty) and context menu trigger.
 * Right-click opens full context menu.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Play, Save, MoreHorizontal } from "lucide-react";
import type { SavedPlan } from "@/lib/types";
import { cn } from "@/lib/utils";
import { totalDistance, formatDistance, timeAgo } from "@/lib/plan-library";
import { PlanContextMenu } from "./PlanContextMenu";

interface PlanTreeItemProps {
  plan: SavedPlan;
  isActive: boolean;
  isDirty: boolean;
  context: "plan" | "simulate";
  onSelect: () => void;
  /** Save handler — shown as inline icon on active+dirty items. */
  onSave?: () => void;
  /** Called when a plan is renamed via context menu (syncs planner state for active plan). */
  onPlanRenamed?: (name: string) => void;
}

export function PlanTreeItem({ plan, isActive, isDirty, context, onSelect, onSave, onPlanRenamed }: PlanTreeItemProps) {
  const t = useTranslations("library");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const dist = totalDistance(plan.waypoints);
  const wpCount = plan.waypoints.length;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleOverflowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom });
  }, []);

  const handleSaveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSave?.();
  }, [onSave]);

  return (
    <>
      <button
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors cursor-pointer group",
          isActive
            ? "bg-accent-primary/10 border-l-2 border-accent-primary"
            : "hover:bg-bg-tertiary border-l-2 border-transparent"
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-status-warning shrink-0" title={t("unsavedChanges")} />
            )}
            <span className="text-xs font-medium text-text-primary truncate">
              {plan.name}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono text-text-tertiary">{wpCount} WP</span>
            {dist > 0 && (
              <span className="text-[10px] font-mono text-text-tertiary">{formatDistance(dist)}</span>
            )}
            <span className="text-[10px] font-mono text-text-tertiary">{timeAgo(plan.updatedAt)}</span>
          </div>
        </div>

        {/* Hover action buttons */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {isActive && isDirty && onSave && (
            <span
              role="button"
              onClick={handleSaveClick}
              className="p-0.5 text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"
              title={t("savePlan")}
            >
              <Save size={12} />
            </span>
          )}

          {context === "simulate" && wpCount >= 2 && (
            <Play size={12} className="text-text-tertiary" />
          )}

          <span
            role="button"
            onClick={handleOverflowClick}
            className="p-0.5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            title={t("moreActions")}
          >
            <MoreHorizontal size={12} />
          </span>
        </div>
      </button>

      {contextMenu && (
        <PlanContextMenu
          planId={plan.id}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPlanRenamed={isActive ? onPlanRenamed : undefined}
        />
      )}
    </>
  );
}
