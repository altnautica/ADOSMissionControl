"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ItemCategory } from "@/lib/community-types";

const categoryConfig: Record<ItemCategory, { className: string }> = {
  command: { className: "text-accent-primary border-accent-primary/30" },
  ados: { className: "text-accent-secondary border-accent-secondary/30" },
  website: { className: "text-status-warning border-status-warning/30" },
  general: { className: "text-text-secondary border-text-tertiary/30" },
};

interface CategoryBadgeProps {
  category: ItemCategory;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const t = useTranslations("community.badges.categories");
  const config = categoryConfig[category];
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium border rounded",
        config.className,
        className
      )}
    >
      {t(category)}
    </span>
  );
}
