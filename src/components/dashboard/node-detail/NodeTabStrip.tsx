"use client";

/**
 * @module node-detail/NodeTabStrip
 * @description The node-detail tab strip: built-in surfaces grouped into
 * labelled sections, followed by plugin-contributed tabs, with one roving
 * keyboard navigation (WAI-ARIA tab pattern) spanning both.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { revealInStrip } from "./reveal-in-strip";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DroneDetailTabHeaders } from "@/components/plugins/DroneDetailTabHost";
import type { PairedNodeProfile } from "@/lib/plugins/types";
import type { SurfaceSpec } from "./surface-types";

const DEFAULT_GROUP = "__ungrouped__";

export function NodeTabStrip({
  surfaces,
  pluginIds,
  visibleTab,
  onSelect,
  bareDeviceId,
  nodeProfile,
}: {
  surfaces: SurfaceSpec[];
  /** The plugin tab ids the plugin header strip renders, in order. */
  pluginIds: string[];
  visibleTab: string;
  onSelect: (tabId: string) => void;
  bareDeviceId: string;
  nodeProfile: PairedNodeProfile | undefined;
}) {
  const t = useTranslations("dronePanel");
  const tRoot = useTranslations();

  // Group consecutive surfaces that share a `group` key into sections for the
  // two-tier tab layout. Order is preserved (grouping never reorders); an
  // ungrouped surface falls into a group with no section label.
  const tabGroups: { key: string; labelKey: string | null; ids: string[] }[] = [];
  for (const s of surfaces) {
    const key = s.group ?? DEFAULT_GROUP;
    const last = tabGroups[tabGroups.length - 1];
    if (last && last.key === key) last.ids.push(s.id);
    else tabGroups.push({ key, labelKey: s.group ?? null, ids: [s.id] });
  }

  // The ordered id list the roving navigation spans: every built-in tab AND
  // every plugin tab, so a plugin tab is reachable from the keyboard.
  const stripIds = [...surfaces.map((s) => s.id), ...pluginIds];
  const moveTab = (key: string) => {
    const idx = stripIds.indexOf(visibleTab);
    let next = idx;
    if (key === "ArrowRight") next = (idx + 1) % stripIds.length;
    else if (key === "ArrowLeft") next = (idx - 1 + stripIds.length) % stripIds.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = stripIds.length - 1;
    else return false;
    const nextId = stripIds[next];
    onSelect(nextId);
    requestAnimationFrame(() => {
      document.getElementById(`drone-tab-${nextId}`)?.focus();
    });
    return true;
  };

  const stripRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  const scrollBy = (dir: 1 | -1) => {
    const el = stripRef.current;
    el?.scrollBy?.({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };

  // Re-measure whenever the strip or its contents change size, and turn a
  // vertical wheel over the strip into a sideways scroll (a non-passive
  // listener, so the page itself does not scroll instead).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    return () => {
      el.removeEventListener("wheel", onWheel);
      ro?.disconnect();
    };
  }, [measure, surfaces, pluginIds]);

  // Keep the selected tab visible (a tab picked by deep link, keyboard or a
  // restored last tab may sit past the edge). Only the strip scrolls.
  useEffect(() => {
    revealInStrip(stripRef.current, document.getElementById(`drone-tab-${visibleTab}`));
  }, [visibleTab]);

  return (
    // The wrapper fills its own header row (`flex-1 min-w-0`); the strip
    // inside SCROLLS its own overflow. A vertical wheel scrolls it sideways,
    // the selected tab is kept in view, and edge buttons appear while tabs
    // are hidden on that side, so a long ground-station strip never reads
    // as clipped.
    <div className="flex items-center self-stretch flex-1 min-w-0">
      {overflow.left ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("scrollTabsLeft")}
          onClick={() => scrollBy(-1)}
          className="flex h-6 w-5 shrink-0 items-center justify-center text-text-tertiary hover:text-text-primary"
        >
          <ChevronLeft size={14} />
        </button>
      ) : null}
      <div
        ref={stripRef}
        role="tablist"
        aria-label={t("nodeDetailTabs")}
        onScroll={measure}
        className="flex items-center self-stretch overflow-x-auto scrollbar-hide flex-1 min-w-0"
      >
        {/* Each group wrapper is `role="presentation"` so the tablist still
            OWNS its tabs; the section label is decoration (`aria-hidden`).
            `shrink-0` is load-bearing: a shrinkable group collapses to its
            min-content width (a multi-word tab's longest word) while its
            `shrink-0` tabs keep full width, so "Carried drones" painted over
            the next group's label. Unshrunk groups overflow the strip, which
            scrolls instead. */}
        {tabGroups.map((group, groupIdx) => (
          <div
            key={group.key}
            role="presentation"
            className={cn(
              "flex items-center self-stretch shrink-0",
              groupIdx > 0 && "ml-2 pl-2 border-l border-border-default/60",
            )}
          >
            {group.labelKey && (
              <span
                aria-hidden="true"
                className="self-center mr-1.5 text-[10px] font-medium uppercase tracking-wider text-text-tertiary select-none shrink-0"
              >
                {tRoot(group.labelKey)}
              </span>
            )}
            {group.ids.map((id) => {
              const surface = surfaces.find((s) => s.id === id);
              if (!surface) return null;
              return (
                <button
                  key={id}
                  id={`drone-tab-${id}`}
                  role="tab"
                  aria-selected={visibleTab === id}
                  aria-controls={`drone-tabpanel-${id}`}
                  tabIndex={visibleTab === id ? 0 : -1}
                  onClick={() => onSelect(id)}
                  onKeyDown={(e) => {
                    if (moveTab(e.key)) e.preventDefault();
                  }}
                  className={cn(
                    "self-stretch flex items-center gap-1 px-2.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer shrink-0 -mb-px border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                    visibleTab === id
                      ? "text-accent-primary border-accent-primary"
                      : "text-text-secondary hover:text-text-primary border-transparent",
                  )}
                >
                  {surface.label ?? tRoot(surface.labelKey)}
                </button>
              );
            })}
          </div>
        ))}
        {/* Plugin-contributed tabs render after the static strip, sorted by
            manifest `order` then pluginId. Only the headers live here; the body
            renders in the panel's tabpanel switch. */}
        <DroneDetailTabHeaders
          agentId={bareDeviceId}
          activeTabId={visibleTab}
          onSelectPluginTab={onSelect}
          nodeProfile={nodeProfile}
          onNavigate={moveTab}
        />
      </div>
      {overflow.right ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("scrollTabsRight")}
          onClick={() => scrollBy(1)}
          className="flex h-6 w-5 shrink-0 items-center justify-center text-text-tertiary hover:text-text-primary"
        >
          <ChevronRight size={14} />
        </button>
      ) : null}
    </div>
  );
}
