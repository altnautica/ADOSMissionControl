/**
 * @module CommunityErrorBoundary
 * @description Route-level error boundary for /community/* pages.
 * Shows inline error UI when Convex queries fail, instead of crashing the whole app.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function CommunityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tk = useTranslations("appPages.community");
  useEffect(() => {
    console.error("[community-error-boundary]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[40vh] p-8">
      <div className="max-w-md w-full text-center space-y-4">
        <h2 className="text-base font-semibold text-text-primary">
          {tk("failedToLoadCommunityData")}
        </h2>
        <p className="text-sm text-text-secondary">
          {error.message || "Could not connect to the backend."}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 transition-colors"
        >
          {tk("retry")}
        </button>
      </div>
    </div>
  );
}
