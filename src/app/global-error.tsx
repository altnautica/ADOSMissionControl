/**
 * @module GlobalError
 * @description Last-resort error boundary for root layout errors (Next.js App Router).
 * Must provide its own <html> + <body> since the root layout may have failed.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

// Only the generated colour tokens: the root layout (and globals.css) may be
// the thing that failed.
import "../styles/tokens.generated.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tk = useTranslations("appPages.globalerror");
  useEffect(() => {
    console.error("[global-error-boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: "var(--alt-bg-primary)", color: "var(--alt-text-primary)", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
          <div style={{ maxWidth: "28rem", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠</div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              {tk("somethingWentWrong")}
            </h2>
            <p style={{ fontSize: "0.875rem", color: "var(--alt-text-secondary)", marginBottom: "1.5rem" }}>
              {error.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                backgroundColor: "var(--alt-accent-primary)",
                color: "var(--alt-accent-foreground)",
                border: "none",
                borderRadius: "0.375rem",
                cursor: "pointer",
              }}
            >
              {tk("tryAgain")}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
