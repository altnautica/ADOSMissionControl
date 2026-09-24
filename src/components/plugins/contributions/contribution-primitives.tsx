/**
 * @module plugins/contributions/contribution-primitives
 * @description Small shared building blocks for the per-type contribution
 * sections in the plugin install pop-up: a labeled subsection with a count and
 * a row with a leading glyph, a primary label, an optional mono id, and
 * trailing meta chips. Kept separate from the sections so the sections and the
 * `PluginContributions` composer can both import them without a cycle.
 *
 * @license GPL-3.0-only
 */

"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/** Maps a UI slot to its i18n sub-key under
 * `pluginInstall.review.contributions.slotKind.*` so a slot panel renders a
 * plain-language "what surface" chip (a `node.detail.tab` reads "Detail tab").
 * Keyed by the raw slot string the install summary carries; covers every
 * canonical `PLUGIN_SLOTS` value, with a `detailTab` fallback for the
 * theoretically-unreachable unknown slot. */
export const SLOT_KIND_KEY: Record<string, string> = {
  "node.detail.tab": "detailTab",
  "cockpit.panel": "cockpitPanel",
  "fc.tab": "fcTab",
  "hardware.tab": "hardwareTab",
  "video.overlay": "videoOverlay",
  "notification.channel": "alert",
  "settings.section": "settings",
  "map.overlay": "mapOverlay",
  "mission.template": "missionTemplate",
  "flight.skill": "skill",
  "node.agent.page": "agentPage",
  "node.surface": "nodeSurface",
};

/** The slotKind i18n sub-key for a raw slot string, falling back to
 * `detailTab` for an unrecognized slot (never reached in practice — the
 * manifest parser only emits canonical slots). */
export function slotKindKey(slot: string): string {
  return SLOT_KIND_KEY[slot] ?? "detailTab";
}

/** A labeled contribution subsection ("Skills (3)", "AI tools (8)", …). */
export function ContribCategory({
  icon: Icon,
  label,
  count,
  children,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        <Icon className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
        <span>{label}</span>
        <span className="tabular-nums text-text-tertiary">({count})</span>
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

/** One contribution row: glyph + primary label + optional mono id + chips. */
export function ContribRow({
  icon: Icon,
  primary,
  secondary,
  monoId,
  chips,
}: {
  icon: LucideIcon;
  primary: string;
  secondary?: string;
  monoId?: string;
  chips?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-border-default/40 bg-bg-tertiary/30 px-3 py-2">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-tertiary/60 text-text-secondary"
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-text-primary">
            {primary}
          </span>
          {chips}
        </div>
        {secondary ? (
          <p className="mt-0.5 text-xs leading-snug text-text-tertiary">
            {secondary}
          </p>
        ) : null}
        {monoId ? (
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary/70">
            {monoId}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** A small pill chip used to badge a contribution row (kind, toggle, …). */
export function MetaChip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn";
  className?: string;
}) {
  const toneClass =
    tone === "accent"
      ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
      : tone === "warn"
        ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
        : "border-border-default/50 bg-bg-tertiary/60 text-text-tertiary";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A monospace key chip for a skill's default hotkey. */
export function KeyChip({ keyLabel }: { keyLabel: string }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border-default/60 bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
      {keyLabel}
    </kbd>
  );
}
