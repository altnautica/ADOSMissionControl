/**
 * @module Tabs
 * @description Shared single-select tab strip. Implements the WAI-ARIA tabs
 * pattern with automatic activation: `role="tablist"`/`role="tab"`, a roving
 * tabindex so the strip is one tab stop, and Arrow/Home/End navigation that
 * moves focus and selection together.
 *
 * It was previously a row of bare `<button>`s with no roles, no
 * `aria-selected` and no arrow-key handling, so a screen reader announced two
 * unrelated buttons and a keyboard operator had to Tab through every leg. The
 * in-repo reference for this pattern is
 * `src/components/cockpit/CockpitStreamTabs.tsx`.
 *
 * The tab panels are owned by the caller. Pass `panelId` on a tab and give the
 * matching panel `role="tabpanel"`, `id={panelId}` and
 * `aria-labelledby={tabId(...)}` to complete the association.
 * @license GPL-3.0-only
 */
"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  /** `id` of the panel this tab controls, for `aria-controls`. */
  panelId?: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist. Without it a screen reader announces an
   * unnamed group of tabs, which is ambiguous once a surface has two strips. */
  label?: string;
  className?: string;
}

/** Stable DOM id for a tab button, so a panel can point back with
 * `aria-labelledby`. Exported because the panel lives in the caller. */
export function tabButtonId(tabId: string): string {
  return `tab-${tabId}`;
}

export function Tabs({ tabs, activeTab, onChange, label, className }: TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTab),
  );

  const move = (step: number) => {
    const n = tabs.length;
    if (n === 0) return;
    const next = (((activeIndex + step) % n) + n) % n;
    onChange(tabs[next]!.id);
    tabRefs.current[next]?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(-activeIndex);
    } else if (e.key === "End") {
      e.preventDefault();
      move(tabs.length - 1 - activeIndex);
    }
  };

  return (
    <div
      className={cn("flex border-b border-border-default flex-shrink-0", className)}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            id={tabButtonId(tab.id)}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={tab.panelId}
            // Roving tabindex: the strip is a single tab stop and the arrows
            // walk it, per the ARIA tabs pattern.
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "px-4 py-2 text-xs font-medium transition-colors cursor-pointer -mb-px border-b-2",
              "focus-ring-inset",
              isActive
                ? "text-accent-primary border-accent-primary"
                : "text-text-secondary hover:text-text-primary border-transparent",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
