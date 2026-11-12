"use client";

/**
 * @module outline/OutlineGroup
 * @description One collapsible group of the plan outline: a chevron that
 * folds the group, a header button that points the inspector at the group,
 * a count, and an optional `+` that starts adding to it. The open state is
 * persisted in the planner store's `sectionOpen` map under `outline.<id>`.
 * @license GPL-3.0-only
 */

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlannerStore } from "@/stores/planner-store";
import { HIT_AREA_48 } from "@/components/planner/hit-area";

interface OutlineGroupProps {
  /** Stable key for the persisted open state. */
  id: string;
  title: string;
  /** Count or short status shown beside the title. */
  meta?: ReactNode;
  /** True when the inspector is showing this group. */
  active: boolean;
  onSelect: () => void;
  /** When set, a `+` button labelled `addLabel` calls it. */
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}

export function OutlineGroup({ id, title, meta, active, onSelect, onAdd, addLabel, children }: OutlineGroupProps) {
  const t = useTranslations("planner.outline");
  const contentId = useId();
  const persistKey = `outline.${id}`;
  const open = usePlannerStore((s) => s.sectionOpen?.[persistKey] ?? true);
  const setSectionOpen = usePlannerStore((s) => s.setSectionOpen);

  return (
    <section className="border-t border-border-default py-1.5 first:border-t-0" data-outline-group={id}>
      <div
        className={cn(
          "group/header flex h-8 items-center gap-0.5 pl-1 pr-1 transition-colors",
          active ? "bg-accent-primary/10" : "hover:bg-bg-tertiary",
        )}
      >
        <button
          type="button"
          onClick={() => setSectionOpen(persistKey, !open)}
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={open ? t("collapse", { group: title }) : t("expand", { group: title })}
          className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-tertiary hover:text-text-primary cursor-pointer focus-ring", HIT_AREA_48)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded px-1 text-left cursor-pointer focus-ring"
        >
          <span
            className={cn(
              "truncate font-body text-[11px] font-semibold",
              active ? "text-accent-primary" : "text-text-tertiary",
            )}
          >
            {title}
          </span>
          {meta !== undefined && (
            <span className="shrink-0 font-mono text-[11px] text-text-tertiary">{meta}</span>
          )}
        </button>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={addLabel}
            title={addLabel}
            className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded text-text-tertiary hover:text-text-primary cursor-pointer focus-ring", HIT_AREA_48)}
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      <div id={contentId} hidden={!open} className="flex flex-col">
        {children}
      </div>
    </section>
  );
}
