/**
 * @module PlanSearchBar
 * @description Search input, sort-field cycle and sort-direction toggle for the
 * plan library. Listens for `plan-library:focus-search` custom event
 * (dispatched by Cmd+O).
 * @license GPL-3.0-only
 */
"use client";

import { useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { usePlanLibraryStore } from "@/stores/plan-library-store";

type SortField = "date" | "name" | "waypoints";

const SORT_ORDER: readonly SortField[] = ["date", "name", "waypoints"];
const SORT_LABEL_KEY = {
  date: "sortLabelDate",
  name: "sortLabelName",
  waypoints: "sortLabelWaypoints",
} as const;
const SORT_TITLE_KEY = {
  date: "sortByDate",
  name: "sortByName",
  waypoints: "sortBySize",
} as const;

export function PlanSearchBar() {
  const t = useTranslations("library");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchQuery = usePlanLibraryStore((s) => s.searchQuery);
  const setSearchQuery = usePlanLibraryStore((s) => s.setSearchQuery);
  const sortBy = usePlanLibraryStore((s) => s.sortBy);
  const setSortBy = usePlanLibraryStore((s) => s.setSortBy);
  const sortDirection = usePlanLibraryStore((s) => s.sortDirection);
  const toggleSortDirection = usePlanLibraryStore((s) => s.toggleSortDirection);

  // Listen for Cmd+O focus event
  useEffect(() => {
    const handler = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("plan-library:focus-search", handler);
    return () => document.removeEventListener("plan-library:focus-search", handler);
  }, []);

  // Cycling the field resets the direction to that field's natural order
  // (names A→Z, newest first); the arrow beside it reverses it.
  const cycleSortBy = () => {
    const next = SORT_ORDER[(SORT_ORDER.indexOf(sortBy) + 1) % SORT_ORDER.length];
    setSortBy(next);
  };
  const directionLabel = sortDirection === "asc" ? t("sortAscending") : t("sortDescending");

  return (
    <div className="px-3 py-2 border-b border-border-default flex items-center gap-2">
      <div className="flex-1 flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-default">
        <Search size={12} className="text-text-tertiary shrink-0" />
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none"
        />
      </div>
      <button
        type="button"
        onClick={cycleSortBy}
        className="flex items-center gap-1 p-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        title={t(SORT_TITLE_KEY[sortBy])}
        aria-label={t(SORT_TITLE_KEY[sortBy])}
      >
        <ArrowUpDown size={12} />
        <span className="text-[10px] font-mono">{t(SORT_LABEL_KEY[sortBy])}</span>
      </button>
      <button
        type="button"
        onClick={toggleSortDirection}
        className="p-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        title={directionLabel}
        aria-label={directionLabel}
      >
        {sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      </button>
    </div>
  );
}
