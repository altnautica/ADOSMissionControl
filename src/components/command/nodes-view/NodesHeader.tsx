"use client";

/**
 * @module command/nodes-view/NodesHeader
 * @description The board toolbar: node search, reach filters, and the
 * fleet-wide actions.
 *
 * The filters are reach kinds rather than an invented bearer taxonomy. Reach is
 * what the board can actually establish per node today, and filtering by
 * something the rows cannot prove would be a filter that lies about what it
 * selected.
 *
 * Fleet actions are the two that have a real path end to end: sending the whole
 * fleet home, and pairing another node. Anything else the board could offer here
 * — re-electing a mesh gateway, retuning every link — has no fleet-wide contract
 * behind it yet, and a menu entry that cannot do its job is worse than its
 * absence.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Search, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NodeReachKind } from "@/lib/nodes/node-reach";
import { DropdownMenu } from "@/components/ui/dropdown-menu";

/** "all" plus each reach kind a row can resolve to. */
export const REACH_FILTERS = [
  "all",
  "lan",
  "cloud",
  "direct-fc",
  "none",
] as const;
export type ReachFilter = (typeof REACH_FILTERS)[number];

/** True when a node of `kind` passes `filter`. */
export function matchesReachFilter(
  filter: ReachFilter,
  kind: NodeReachKind,
): boolean {
  return filter === "all" || filter === kind;
}

export function NodesHeader({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  counts,
  onReturnAll,
  onAddNode,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  filter: ReachFilter;
  onFilterChange: (filter: ReachFilter) => void;
  /** How many nodes sit behind each filter, so a chip never hides an empty set. */
  counts: Record<ReachFilter, number>;
  onReturnAll: () => void;
  onAddNode: () => void;
}) {
  const t = useTranslations("nodesView");

  return (
    <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex items-center">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 text-text-tertiary"
          />
          <span className="sr-only">{t("searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-48 rounded border border-border-default bg-bg-secondary py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          {REACH_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => onFilterChange(id)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                filter === id
                  ? "bg-accent-primary text-bg-primary"
                  : "border border-border-default bg-bg-secondary text-text-secondary hover:text-text-primary",
              )}
            >
              {t(`filter.${id}`)}
              <span className="ml-1 tabular-nums opacity-70">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      <DropdownMenu
        align="right"
        items={[
          { id: "return-all", label: t("fleet.returnAll"), danger: true },
          { id: "add-node", label: t("fleet.addNode") },
        ]}
        onSelect={(id) => {
          if (id === "return-all") onReturnAll();
          if (id === "add-node") onAddNode();
        }}
        trigger={
          <button
            type="button"
            className="flex items-center gap-1.5 rounded bg-accent-primary px-2.5 py-1 text-xs font-medium text-bg-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <Zap size={12} />
            {t("fleet.actions")}
          </button>
        }
      />
    </div>
  );
}
