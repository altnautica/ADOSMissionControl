/**
 * @module AppErrorBoundary
 * @description App-level error boundary (Next.js App Router convention).
 * Catches unhandled exceptions and shows a recovery UI instead of a white screen.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tk = useTranslations("appPages.error");
  useEffect(() => {
    console.error("[app-error-boundary]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-4xl">⚠</div>
        <h2 className="text-lg font-semibold text-text-primary">
          {tk("somethingWentWrong")}
        </h2>
        <p className="text-sm text-text-secondary">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 transition-colors"
        >
          {tk("tryAgain")}
        </button>
      </div>
    </div>
  );
}
