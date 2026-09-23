"use client";

/**
 * @module CategoryFilter
 * @description Reusable horizontal pill filter for category selection.
 * @license GPL-3.0-only
 */

import { cn } from "@/lib/utils";

interface Category {
  id: string;
  label: string;
  count?: number;
}

interface CategoryFilterProps {
  categories: Category[];
  active: string;
  onChange: (id: string) => void;
}

export function CategoryFilter({ categories, active, onChange }: CategoryFilterProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-full transition-colors",
            active === cat.id
              ? "bg-accent-primary text-accent-foreground"
              : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
          )}
        >
          {cat.label}
          {cat.count !== undefined && (
            <span className="ml-1 opacity-70">{cat.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
