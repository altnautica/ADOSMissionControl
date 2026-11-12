"use client";

/**
 * @module components/fc/security/SigningHistorySection
 * @description Collapsed History disclosure for the Signing panel.
 *
 * Reads `cmd_signingEvents` for the selected drone, scoped to the
 * authenticated user. Renders the last 50 events newest-first with
 * relative-time stamps and event-type badges. Silent no-op when the
 * user is signed out: anonymous signing actions don't hit Convex.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cmdSigningEventsApi } from "@/lib/community-api-drones";
import { useAuthStore } from "@/stores/auth-store";

interface Props {
  droneId: string;
}

export function SigningHistorySection({ droneId }: Props) {
  const tr = useTranslations("fcPanels.signingHistorySection");
  const [open, setOpen] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);

  // Only query Convex when signed in; otherwise skip guard returns [].
  const events = useQuery(
    cmdSigningEventsApi.listForDrone,
    isAuthenticated && !authLoading ? { droneId, limit: 50 } : "skip",
  );

  const count = Array.isArray(events) ? events.length : 0;

  return (
    <details
      className="border-t border-border-default pt-3"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="list-none cursor-pointer flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary">
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <span className="font-medium">{tr("history")}</span>
        {isAuthenticated ? (
          <span className="text-xs text-text-tertiary">({count} events)</span>
        ) : (
          <span className="text-xs text-text-tertiary">
            (sign in to see signing history)
          </span>
        )}
      </summary>
      {open && (
        <div className="mt-3">
          {!isAuthenticated ? (
            <p className="text-xs text-text-tertiary py-2">
              {tr("signInToCloudSync")}
            </p>
          ) : events === undefined ? (
            <p className="text-xs text-text-tertiary py-2">{tr("loadingHistory")}</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-text-tertiary py-2">
              {tr("noSigningEventsRecordedFor")}
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[280px] overflow-y-auto">
              {events.map((ev) => (
                <li
                  key={ev._id}
                  className="flex items-start gap-3 text-xs py-1 border-b border-border-default/40 last:border-b-0"
                >
                  <span className="text-text-tertiary font-mono shrink-0 w-20">
                    {relativeTime(ev.createdAt)}
                  </span>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 shrink-0 ${eventTypeClass(
                      ev.eventType,
                    )}`}
                  >
                    {ev.eventType.replace(/_/g, " ")}
                  </span>
                  <span className="text-text-secondary font-mono">
                    {ev.keyIdOld && ev.keyIdNew
                      ? `${ev.keyIdOld} → ${ev.keyIdNew}`
                      : ev.keyIdNew
                        ? ev.keyIdNew
                        : ev.keyIdOld
                          ? ev.keyIdOld
                          : ""}
                  </span>
                  <span className="text-text-tertiary font-mono text-[10px] ml-auto shrink-0">
                    {ev.deviceFingerprint.slice(0, 6)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

/** Short relative-time string: 2m, 1h, 3d. */
function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  const days = Math.floor(delta / 86_400_000);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function eventTypeClass(eventType: string): string {
  switch (eventType) {
    case "enrollment":
    case "rotation":
    case "import":
      return "text-status-success bg-status-success/10";
    case "export":
    case "require_on":
    case "require_off":
    case "cloud_sync_on":
    case "cloud_sync_off":
      return "text-accent-primary bg-accent-primary/10";
    case "disable":
    case "clear_fc":
    case "user_purge_on_signout":
      return "text-status-error bg-status-error/10";
    case "key_mismatch_detected":
    case "fc_rejected_enrollment":
      return "text-status-warning bg-status-warning/10";
    default:
      return "text-text-tertiary bg-bg-tertiary";
  }
}
