/**
 * @module PluginBadgeRow
 * @description The consolidated identity/trust strip shown at the top of the
 * plugin install pop-up (and reusable on any plugin surface). One row that
 * carries the derived trust badges (signed / verified / first-party /
 * open-source / vendor-binary), a halves chip (Agent + GCS / Agent / GCS),
 * and an optional category chip. It replaces the three inconsistent inline
 * badge maps that predated it.
 *
 * Trust badges are the already-computed {@link displayTrustSignals} set the
 * caller passes in (the manifest's `trustSignals`, derived once at parse), so
 * this row can never disagree with the cards or the MCP tab.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { Package, Puzzle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PluginHalf } from "@/lib/plugins/types";
import type { TrustSignal } from "@/lib/plugins/trust-signals";

import { TrustBadge } from "./TrustBadge";

export interface PluginBadgeRowProps {
  /** The already-derived display trust-signal set (from
   * {@link displayTrustSignals}). Consumed as-is, never re-derived here. */
  signals: ReadonlyArray<TrustSignal>;
  halves: ReadonlyArray<PluginHalf>;
  /** Optional registry category (drivers / ui / ai / …). Rendered as a chip
   * when the caller has it; the install summary has no category so the pop-up
   * omits it. */
  category?: string;
  className?: string;
}

export function PluginBadgeRow({
  signals,
  halves,
  category,
  className,
}: PluginBadgeRowProps) {
  const t = useTranslations("plugins.badges");
  const hasAgent = halves.includes("agent");
  const hasGcs = halves.includes("gcs");
  const halvesLabel =
    hasAgent && hasGcs
      ? t("hybrid")
      : hasAgent
        ? t("agent")
        : hasGcs
          ? t("gcs")
          : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {signals.map((s) => (
        <TrustBadge key={s} signal={s} />
      ))}
      {halvesLabel && (
        <span className="inline-flex items-center gap-1 rounded-md border border-border-default/50 bg-bg-tertiary/50 px-2 py-0.5 text-xs font-medium text-text-secondary">
          <Puzzle className="h-3 w-3" aria-hidden />
          {halvesLabel}
        </span>
      )}
      {category && (
        <span className="inline-flex items-center gap-1 rounded-md border border-border-default/50 bg-bg-tertiary/50 px-2 py-0.5 text-xs font-medium text-text-secondary">
          <Package className="h-3 w-3" aria-hidden />
          {category}
        </span>
      )}
    </div>
  );
}
