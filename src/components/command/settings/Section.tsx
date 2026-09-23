"use client";

/**
 * @module command/settings/Section
 * @description The shared chrome for node Settings tab sections: one CARD
 * class, a titled section shell (optional icon + blurb), and the small read
 * rows and notes every page renders, so each page uses one copy instead of
 * re-declaring it.
 * @license GPL-3.0-only
 */

import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { getFreshness, useClockTick } from "@/lib/agent/freshness";
import { cn } from "@/lib/utils";

const CARD = "rounded border border-border-default bg-bg-secondary p-5";

export function Section({
  title,
  icon: Icon,
  blurb,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      {Icon ? (
        <div className="mb-3 flex items-center gap-2">
          <Icon size={16} className="text-accent-primary" aria-hidden="true" />
          <h2 className="text-lg font-medium text-text-primary">{title}</h2>
        </div>
      ) : (
        <h2 className="mb-3 text-lg font-medium text-text-primary">{title}</h2>
      )}
      {blurb ? <p className="mb-4 text-xs text-text-secondary">{blurb}</p> : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** A muted explanatory note (no path, unsupported profile, config-only). */
export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
      {children}
    </div>
  );
}

/**
 * A compact label / mono value pair for a reported fact. A null or empty value
 * is a fact the node has not reported, and says so rather than rendering a
 * blank or a fabricated default.
 */
export function ReadRow({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations("nodeSettings");
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-xs text-text-primary">
        {value != null && value.length > 0 ? (
          value
        ) : (
          <span className="text-text-tertiary">{t("notReported")}</span>
        )}
      </span>
    </div>
  );
}

/** A labelled status value with an optional tone class and hint. */
export function StatusRow({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-text-secondary">{label}</span>
        <span
          className={cn(
            "shrink-0 font-mono text-xs",
            valueClass ?? "text-text-primary",
          )}
        >
          {value}
        </span>
      </div>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The outcome of a polled live read. Shown whenever the NEWEST poll failed,
 * not only before the first success: a page that keeps rendering its last
 * snapshot after the link drops must say the snapshot is old and how old.
 */
export function PollFailureNote({
  failed,
  fetchedAt,
  message,
}: {
  failed: boolean;
  /** Wall-clock ms of the last successful poll, or null when none landed. */
  fetchedAt: number | null;
  message: string;
}) {
  const t = useTranslations("nodeSettings");
  // Re-render on the shared clock so the age counts up.
  useClockTick();
  if (!failed) return null;
  return (
    <div
      role="status"
      className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error"
    >
      {message}
      {fetchedAt !== null ? (
        <span className="block text-text-tertiary">
          {t("staleSnapshot", { age: getFreshness(fetchedAt).label })}
        </span>
      ) : null}
    </div>
  );
}
