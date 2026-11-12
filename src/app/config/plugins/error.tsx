/**
 * @module PluginsRouteError
 * @description Per-segment error boundary for `/config/plugins/*`.
 * Keeps the Installed/Browse inner tab nav mounted when a child page
 * throws. Convex query errors are already absorbed by
 * `useConvexSkipQuery`; this boundary only catches non-Convex throws
 * (component bugs, render-time exceptions, third-party calls).
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function PluginsRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tk = useTranslations("appPages.configPlugins");
  useEffect(() => {
    console.error("[plugins-error-boundary]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center p-6 min-h-[30vh]">
      <div className="max-w-sm w-full text-center space-y-3">
        <div className="text-2xl">⚠</div>
        <h2 className="text-sm font-semibold text-text-primary">
          {tk("pluginsPageFailedToRender")}
        </h2>
        <p className="text-xs text-text-secondary">
          {error.message || "Unexpected error inside the plugins panel."}
        </p>
        <button
          onClick={reset}
          className="px-3 py-1.5 text-xs font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 transition-colors"
        >
          {tk("tryAgain")}
        </button>
      </div>
    </div>
  );
}
