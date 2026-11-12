"use client";

/**
 * @module RegistryCatalogBrowser
 * @description The presentational half of the registry catalog: section
 * header, search box, category filter chips, loading skeleton, empty state,
 * and the card grid. It owns the search + category state and filters the rows
 * it is handed; the caller supplies the rows and renders each card. The
 * Convex-backed `RegistryPluginGrid` and the demo-mode `DemoRegistryGrid` both
 * render through it, so the two catalogs cannot drift apart.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Package, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RegistryCategory, RegistryPluginRow } from "@/lib/plugins/registry-row";

export type CategoryFilter = "all" | RegistryCategory;

export const REGISTRY_CATEGORIES: ReadonlyArray<RegistryCategory> = [
  "drivers",
  "ui",
  "ai",
  "telemetry",
  "tools",
];

/** Client-side catalog filter: category match, then a case-insensitive
 * substring search over name + description. */
export function filterRegistryRows<R extends RegistryPluginRow>(
  rows: ReadonlyArray<R>,
  search: string,
  category: CategoryFilter,
): R[] {
  const needle = search.trim().toLowerCase();
  return rows.filter((p) => {
    if (category !== "all" && p.category !== category) return false;
    if (needle) {
      const haystack = `${p.name} ${p.description}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export interface RegistryCatalogBrowserProps<R extends RegistryPluginRow> {
  /** Catalog rows; `undefined` while the source is still loading. */
  rows: ReadonlyArray<R> | undefined;
  /** Renders one card. Must return an `<li>` carrying `data-plugin-id`. */
  renderCard: (row: R) => ReactNode;
  /** Registry plugin id to scroll into view once it is in the grid. */
  preselectPluginId?: string | null;
  /** Rendered after the grid (the install pop-up). */
  children?: ReactNode;
}

export function RegistryCatalogBrowser<R extends RegistryPluginRow>({
  rows,
  renderCard,
  preselectPluginId = null,
  children,
}: RegistryCatalogBrowserProps<R>) {
  const t = useTranslations("pluginRegistry.browse");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const gridRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(
    () => (rows ? filterRegistryRows(rows, search, category) : []),
    [rows, search, category],
  );

  // A Settings "Install on a node…" hand-off lands here with the plugin's
  // id; scroll it into view once the catalog has loaded far enough to
  // contain it. The card draws its own highlight ring.
  useEffect(() => {
    if (!preselectPluginId || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(
      `[data-plugin-id="${CSS.escape(preselectPluginId)}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [preselectPluginId, filtered]);

  return (
    <section className="space-y-3">
      <RegistrySectionHeader />
      <Toolbar
        search={search}
        setSearch={setSearch}
        category={category}
        setCategory={setCategory}
      />

      {rows === undefined && <SkeletonList />}

      {rows !== undefined && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-default p-6 text-center">
          <Package className="h-6 w-6 text-text-tertiary" aria-hidden />
          <p className="text-sm text-text-primary">{t("empty.title")}</p>
          <p className="text-xs text-text-tertiary">{t("empty.subtitle")}</p>
        </div>
      )}

      {rows !== undefined && filtered.length > 0 && (
        <ul ref={gridRef} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((row) => renderCard(row))}
        </ul>
      )}

      {children}
    </section>
  );
}

export function RegistrySectionHeader() {
  const t = useTranslations("pluginRegistry.browse");
  return (
    <header className="space-y-0.5">
      <h3 className="text-base font-semibold text-text-primary">
        {t("title")}
      </h3>
      <p className="text-xs text-text-tertiary">{t("subtitle")}</p>
    </header>
  );
}

/** The "Installed" marker a catalog card shows when the plugin is already on
 * the target node. Shared so the live and demo cards mark it identically. */
export function RegistryInstalledPill() {
  const t = useTranslations("pluginRegistry.browse");
  return (
    <Badge variant="success" size="sm">
      {t("card.installedPill")}
    </Badge>
  );
}

function Toolbar({
  search,
  setSearch,
  category,
  setCategory,
}: {
  search: string;
  setSearch: (v: string) => void;
  category: CategoryFilter;
  setCategory: (v: CategoryFilter) => void;
}) {
  const tq = useTranslations("dashboard.registryCatalogBrowser");
  const t = useTranslations("pluginRegistry.browse");
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-md border border-border-default bg-bg-secondary py-1.5 pl-7 pr-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          aria-label={t("searchPlaceholder")}
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={tq("filter")}>
        <CategoryChip
          active={category === "all"}
          onClick={() => setCategory("all")}
          label={t("category.all")}
        />
        {REGISTRY_CATEGORIES.map((c) => (
          <CategoryChip
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
            label={t(`category.${c}`)}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs transition-colors",
        active
          ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
          : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-strong",
      )}
    >
      {label}
    </button>
  );
}

function SkeletonList() {
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-[120px] animate-pulse rounded-md border border-border-default bg-bg-secondary"
        />
      ))}
    </ul>
  );
}
