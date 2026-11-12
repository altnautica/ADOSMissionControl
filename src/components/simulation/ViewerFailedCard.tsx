/**
 * @module ViewerFailedCard
 * @description The state a 3D view shows when Cesium could not start (no
 * WebGL, a token or tile failure): what happened in words, the raw error on a
 * details line, a Retry, and the surface's own way out (Switch to 2D in the
 * planner, Edit in Planner in Simulate).
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface ViewerFailedCardProps {
  /** The raw error message, shown as a details line. */
  message: string;
  onRetry: () => void;
  /** The surface's alternative to the 3D view. */
  fallback: { label: string; onClick: () => void };
}

export function ViewerFailedCard({ message, onRetry, fallback }: ViewerFailedCardProps) {
  const t = useTranslations("simulate");
  const tCommon = useTranslations("common");
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      <div
        role="alert"
        className="pointer-events-auto bg-bg-primary/80 backdrop-blur-md rounded-lg px-6 py-4 border border-status-error/30 text-center max-w-sm"
      >
        <p className="text-sm text-status-error">{t("viewUnavailable")}</p>
        <p className="mt-1 text-[11px] font-mono text-text-tertiary break-words">{message}</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {tCommon("retry")}
          </Button>
          <Button variant="primary" size="sm" onClick={fallback.onClick}>
            {fallback.label}
          </Button>
        </div>
      </div>
    </div>
  );
}
