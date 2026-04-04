"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ItemStatus } from "@/lib/community-types";

const statusConfig: Record<ItemStatus, { className: string }> = {
  backlog: { className: "text-text-tertiary bg-text-tertiary/10" },
  in_discussion: { className: "text-accent-primary bg-accent-primary/10" },
  planned: { className: "text-status-warning bg-status-warning/10" },
  in_progress: { className: "text-accent-primary bg-accent-primary/10" },
  released: { className: "text-status-success bg-status-success/10" },
  wont_do: { className: "text-text-tertiary bg-text-tertiary/10" },
};

interface StatusBadgeProps {
  status: ItemStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useTranslations("community.badges.statuses");
  const config = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded",
        config.className,
        className
      )}
    >
      {t(status)}
    </span>
  );
}
