"use client";

import { useMemo, useState } from "react";
import { Search, GripVertical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isVisibleInProfile, type BfOsdElement } from "./bf-osd-constants";

interface BfOsdElementListProps {
  elements: BfOsdElement[];
  /** 1-based OSD profile whose visibility the checkboxes show and toggle. */
  activeProfile: number;
  selectedId: number | null;
  onSelectElement: (id: number | null) => void;
  onToggleVisibility: (id: number) => void;
  onResetAll: () => void;
}

export function BfOsdElementList({
  elements, activeProfile, selectedId, onSelectElement, onToggleVisibility, onResetAll,
}: BfOsdElementListProps) {
  const [searchFilter, setSearchFilter] = useState("");

  const filteredElements = useMemo(() => {
    if (!searchFilter) return elements;
    const q = searchFilter.toLowerCase();
    return elements.filter(
      (el) =>
        el.name.toLowerCase().includes(q) ||
        el.shortLabel.toLowerCase().includes(q),
    );
  }, [elements, searchFilter]);

  return (
    <div className="w-56 flex flex-col gap-2 shrink-0">
      {/* Search */}
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
        <input
          type="text"
          placeholder="Filter elements..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="w-full h-7 pl-7 pr-2 bg-bg-tertiary border border-border-default text-xs text-text-primary
                     placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
        />
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto border border-border-default bg-bg-secondary min-h-0">
        {filteredElements.map((el) => {
          const isSelected = el.id === selectedId;
          const visible = isVisibleInProfile(el, activeProfile);
          return (
            <div
              key={el.id}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors",
                isSelected
                  ? "bg-accent-primary/10 border-l-2 border-l-accent-primary"
                  : "border-l-2 border-l-transparent hover:bg-bg-tertiary/50",
              )}
              onClick={() => onSelectElement(el.id)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(el.id);
                }}
                className={cn(
                  "shrink-0 w-4 h-4 border flex items-center justify-center transition-colors",
                  visible
                    ? "bg-accent-primary border-accent-primary"
                    : "bg-transparent border-border-default",
                )}
              >
                {visible && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <GripVertical size={10} className="text-text-tertiary shrink-0" />
              <span
                className={cn(
                  "text-xs truncate",
                  visible ? "text-text-primary" : "text-text-tertiary",
                )}
              >
                {el.name}
              </span>
            </div>
          );
        })}
      </div>

      {/* Reset button */}
      <Button
        variant="ghost"
        size="sm"
        icon={<RotateCcw size={12} />}
        onClick={onResetAll}
        className="w-full"
      >
        Reset All
      </Button>
    </div>
  );
}
