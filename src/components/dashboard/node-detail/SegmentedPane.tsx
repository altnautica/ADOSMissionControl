"use client";

/**
 * @module node-detail/SegmentedPane
 * @description Two (or more) halves of ONE subsystem behind a segmented
 * control, instead of two adjacent navigation rows whose labels differ by a
 * suffix.
 *
 * Three subsystems used to present as six sidebar rows — Link / Radio,
 * Perception / Perception setup, World Model / World model setup — where the
 * registry's own comments admitted the pair "would otherwise read as the same
 * thing". The disambiguating word was carrying the entire information
 * architecture. One row per subsystem, with the live view and its setup as
 * segments, is the structure that naming was standing in for.
 * @license GPL-3.0-only
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PaneSegment {
  id: string;
  label: string;
  render: () => ReactNode;
}

export function SegmentedPane({
  segments,
  initialId,
  ariaLabel,
}: {
  segments: PaneSegment[];
  /** Which segment opens first. A deep link to a retired "…-config" id lands
   * here with the setup segment named, so the operator arrives where they
   * asked rather than on the live view. */
  initialId?: string;
  ariaLabel: string;
}) {
  const [activeId, setActiveId] = useState(
    () => initialId ?? segments[0]?.id ?? "",
  );
  const active = segments.find((s) => s.id === activeId) ?? segments[0];
  if (!active) return null;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex shrink-0 items-center gap-1 border-b border-border-default px-3 py-1.5"
      >
        {segments.map((segment) => {
          const selected = segment.id === active.id;
          return (
            <button
              key={segment.id}
              type="button"
              role="tab"
              id={`pane-seg-${segment.id}`}
              aria-selected={selected}
              aria-controls={`pane-seg-panel-${segment.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(segment.id)}
              onKeyDown={(e) => {
                const idx = segments.findIndex((s) => s.id === active.id);
                let next = idx;
                if (e.key === "ArrowRight") next = (idx + 1) % segments.length;
                else if (e.key === "ArrowLeft")
                  next = (idx - 1 + segments.length) % segments.length;
                else if (e.key === "Home") next = 0;
                else if (e.key === "End") next = segments.length - 1;
                else return;
                e.preventDefault();
                const nextId = segments[next].id;
                setActiveId(nextId);
                requestAnimationFrame(() => {
                  document.getElementById(`pane-seg-${nextId}`)?.focus();
                });
              }}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                selected
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {segment.label}
            </button>
          );
        })}
      </div>
      <div
        id={`pane-seg-panel-${active.id}`}
        role="tabpanel"
        aria-labelledby={`pane-seg-${active.id}`}
        tabIndex={0}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col"
      >
        {active.render()}
      </div>
    </div>
  );
}
