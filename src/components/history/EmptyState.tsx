"use client";

/**
 * Empty state for the Flight History page when no records exist.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { History as HistoryIcon } from "lucide-react";

export function EmptyState() {
  const t = useTranslations("history");
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-surface-secondary text-text-tertiary">
        <HistoryIcon size={24} />
      </div>
      <h2 className="text-sm font-display font-semibold text-text-primary">
        {t("emptyTitle")}
      </h2>
      <p className="mt-2 max-w-md text-xs text-text-tertiary leading-relaxed">
        {t("emptySubtitle")}
      </p>
    </div>
  );
}
