"use client";

/**
 * @module node-detail/agent/NodeSubNav
 * @description Reusable secondary-sidebar chrome for a node-detail page that
 * hosts sub-pages (the Agent page). A titled left rail with labelled sections
 * and nav-item buttons; the active item gets the accent tint + left border.
 * Styled to match the Setup tab's Flight Controller sidebar so both read as one
 * pattern.
 *
 * The rail scrolls independently of the content pane and carries ~25 entries
 * across six sections, so two things hold it together at that length: section
 * headers stick to the top of the rail while their items scroll past, and the
 * active item is scrolled into view whenever it changes — including the restore
 * of a remembered sub-page that sits below the fold.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SubNavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface SubNavSection {
  key: string;
  label: string;
  items: SubNavItem[];
}

interface NodeSubNavProps {
  title: string;
  sections: SubNavSection[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function NodeSubNav({
  title,
  sections,
  activeId,
  onSelect,
}: NodeSubNavProps) {
  const navRef = useRef<HTMLElement | null>(null);

  // Keep the open page visible in the rail. Without this, restoring a
  // remembered sub-page from the bottom of the list leaves the rail scrolled to
  // the top with nothing highlighted on screen.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <nav
      ref={navRef}
      className="w-[200px] border-r border-border-default bg-bg-secondary flex-shrink-0 overflow-y-auto"
    >
      <div className="px-3 py-3 border-b border-border-default">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {title}
        </h2>
      </div>
      <div className="flex flex-col py-1">
        {sections.map((section) => (
          <div key={section.key}>
            <div className="sticky top-0 z-10 bg-bg-secondary px-3 pt-3 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {section.label}
              </span>
            </div>
            {section.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                aria-current={activeId === item.id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors cursor-pointer w-full",
                  activeId === item.id
                    ? "text-accent-primary bg-accent-primary/10 border-l-2 border-l-accent-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border-l-2 border-l-transparent",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
