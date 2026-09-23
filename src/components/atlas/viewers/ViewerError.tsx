"use client";

/**
 * @module atlas/viewers/ViewerError
 * @description The honest failure overlay for a World Model viewer — shown when
 * the viewer's code chunk or its remote artifact fails to load, so the operator
 * sees "failed to load" rather than a permanently-blank viewport (no fabricated reading).
 * @license GPL-3.0-only
 */

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

export function ViewerError({ what }: { what: string }) {
  const t = useTranslations("atlas");
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/60 p-6">
      <div className="flex items-center gap-2 text-[11px] text-status-warning">
        <AlertTriangle className="w-4 h-4" />
        <span>{t("viewerError", { what })}</span>
      </div>
    </div>
  );
}
