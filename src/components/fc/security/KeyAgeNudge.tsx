"use client";

/**
 * @module components/fc/security/KeyAgeNudge
 * @description Reminds operators to rotate signing keys older than 180
 * days. Dismissable for 30 days via localStorage per drone.
 *
 * Industry best practice for shared-secret HMAC keys is rotation every
 * 6-12 months. This nudge lands at the six-month boundary without being
 * so aggressive that operators start dismissing it reflexively.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Clock, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  droneId: string;
  enrolledAt: string | null;
  onRotate: () => void;
  busy?: boolean;
}

export const KEY_AGE_NUDGE_DAYS = 180;
export const KEY_AGE_SNOOZE_DAYS = 30;
const STORAGE_KEY_PREFIX = "signing-age-nudge-snooze:";

export function KeyAgeNudge({ droneId, enrolledAt, onRotate, busy }: Props) {
  const tk = useTranslations("fcPanels.keyAgeNudge");
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!droneId) {
      setDismissed(true);
      return;
    }
    const until = readSnoozeUntil(droneId);
    setDismissed(until !== null && until > Date.now());
  }, [droneId]);

  if (dismissed === null || dismissed) return null;
  if (!enrolledAt) return null;

  const ageDays = daysSince(enrolledAt);
  if (ageDays === null || ageDays < KEY_AGE_NUDGE_DAYS) return null;

  function handleSnooze() {
    writeSnoozeUntil(droneId, Date.now() + KEY_AGE_SNOOZE_DAYS * 24 * 3600 * 1000);
    setDismissed(true);
  }

  return (
    <div
      role="note"
      className="border border-status-warning/40 bg-status-warning/5 p-3 flex items-start gap-2"
    >
      <Clock size={14} className="text-status-warning mt-0.5" aria-hidden="true" />
      <div className="flex-1 space-y-2">
        <p className="text-sm text-text-primary">
          This signing key was enrolled {ageDays} days ago. Consider rotating
          for healthy key hygiene.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRotate}
            disabled={busy}
            className="px-2.5 py-1 text-xs border border-border-default hover:bg-bg-tertiary disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <RotateCw size={12} aria-hidden="true" />
            {tk("rotateNow")}
          </button>
          <button
            type="button"
            onClick={handleSnooze}
            className="px-2.5 py-1 text-xs text-text-tertiary hover:text-text-secondary inline-flex items-center gap-1.5"
          >
            <X size={12} aria-hidden="true" />
            {tk("remindMeIn30Days")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Days between `iso` and now. Returns null on parse failure so the
 * nudge renders conservatively (never shows).
 */
export function daysSince(iso: string): number | null {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / (24 * 3600 * 1000));
}

function readSnoozeUntil(droneId: string): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(STORAGE_KEY_PREFIX + droneId);
    if (v === null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeSnoozeUntil(droneId: string, until: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY_PREFIX + droneId, String(until));
  } catch {
    // private mode or quota exceeded; snooze becomes session-local
  }
}
