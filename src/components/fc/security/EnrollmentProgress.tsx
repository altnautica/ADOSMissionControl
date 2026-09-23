"use client";

/**
 * @module components/fc/security/EnrollmentProgress
 * @description Tiered progress UI for signing-key enrollment.
 *
 * Enrollment sends SETUP_SIGNING twice then reads back SIGNING_REQUIRE.
 * On a fast serial link this completes in under a second. On a slow
 * radio link (57600 baud or cellular-relayed) it can take 5-10 seconds
 * or stall entirely. Instead of a static spinner, we show escalating
 * copy at 3s, 10s, and 30s boundaries so operators understand the
 * enrollment is still in progress and when to give up.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, RotateCw } from "lucide-react";

export type EnrollmentProgressTier = "normal" | "slow" | "stuck" | "failed";

interface Props {
  /** Wall-clock ms when enrollment started. */
  startedAt: number;
  /** Whether enrollment has timed out (tier reached "failed"). */
  failed?: boolean;
  /** Called when the user clicks Retry in the failed tier. */
  onRetry?: () => void;
  /** Called when the user clicks Cancel in the failed tier. */
  onCancel?: () => void;
}

/** Tier thresholds in milliseconds. Kept module-scope so tests can import. */
export const ENROLL_SLOW_MS = 3_000;
export const ENROLL_STUCK_MS = 10_000;
export const ENROLL_FAIL_MS = 30_000;

export function tierForElapsed(elapsedMs: number, failed = false): EnrollmentProgressTier {
  if (failed) return "failed";
  if (elapsedMs >= ENROLL_FAIL_MS) return "failed";
  if (elapsedMs >= ENROLL_STUCK_MS) return "stuck";
  if (elapsedMs >= ENROLL_SLOW_MS) return "slow";
  return "normal";
}

export function EnrollmentProgress({ startedAt, failed, onRetry, onCancel }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = Math.max(0, now - startedAt);
  const tier = tierForElapsed(elapsedMs, failed);
  const copy = COPY_BY_TIER[tier];

  if (tier === "failed") {
    return (
      <div
        role="alert"
        className="border border-status-error/40 bg-status-error/5 p-4 space-y-3"
      >
        <div className="flex items-center gap-2 text-status-error">
          <AlertTriangle size={16} aria-hidden="true" />
          <span className="font-medium">{copy.title}</span>
        </div>
        <p className="text-sm text-text-secondary">{copy.detail}</p>
        <div className="flex gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary inline-flex items-center gap-1.5"
            >
              <RotateCw size={14} aria-hidden="true" />
              Retry
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-text-tertiary hover:text-text-secondary"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 text-sm text-text-secondary"
    >
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      <span>{copy.title}</span>
      {tier !== "normal" && (
        <span className="text-xs text-text-tertiary">({Math.round(elapsedMs / 1000)}s)</span>
      )}
    </div>
  );
}

const COPY_BY_TIER: Record<EnrollmentProgressTier, { title: string; detail: string }> = {
  normal: {
    title: "Enrolling signing key…",
    detail: "Sending SETUP_SIGNING to the flight controller.",
  },
  slow: {
    title: "Enrolling signing key (taking longer than expected on slow links)…",
    detail: "Slow serial or cellular links can take several seconds.",
  },
  stuck: {
    title: "Still enrolling. Don't close this dialog.",
    detail: "Hold on while the flight controller acknowledges the key.",
  },
  failed: {
    title: "Enrollment did not complete",
    detail:
      "The flight controller did not acknowledge the signing key within 30 seconds. The drone may be on a very slow link, or the link dropped mid-enrollment. Check the Signing panel after the drone reconnects.",
  },
};
