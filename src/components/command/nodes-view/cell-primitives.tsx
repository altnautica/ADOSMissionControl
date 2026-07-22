"use client";

/**
 * @module command/nodes-view/cell-primitives
 * @description The board's shared truthfulness primitives.
 *
 * Every live cell on this board reads a value the node last pushed. How much
 * that value is worth depends entirely on how recently the node was heard from,
 * so freshness is resolved once per row and every cell renders against it: a
 * live node shows its reading, a stale node shows it dimmed and says how old it
 * is, and an unreachable node shows nothing at all rather than the last number
 * it happened to send before it went dark.
 *
 * @license GPL-3.0-only
 */

import { cn } from "@/lib/utils";
import type { CommandAgentLiveness } from "@/hooks/use-command-agent-fleet";

/** How much a node's last-pushed reading is worth right now. */
export type ReadingFreshness = "fresh" | "stale" | "none";

/** A reading is only fresh while the node is live; an offline node has none. */
export function readingFreshness(
  liveness: CommandAgentLiveness,
): ReadingFreshness {
  if (liveness === "live") return "fresh";
  if (liveness === "stale") return "stale";
  return "none";
}

/** Dim tone applied to a last-known reading so it never reads as current. */
export function staleClass(freshness: ReadingFreshness): string {
  return freshness === "stale" ? "opacity-60" : "";
}

/**
 * The value a cell renders when it has nothing true to show. `title` names the
 * reason so the blank is explained rather than merely empty.
 *
 * The reason is the cell's accessible text: a screen reader hears it instead
 * of a bare dash. It rides a visually-hidden span rather than `aria-label`
 * because a plain span maps to the generic role, on which `aria-label` is
 * prohibited and ignored by the major screen readers. The dash stays for
 * sighted operators, with the reason still on hover.
 */
export function UnknownValue({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <span className={cn("text-text-tertiary", className)} title={title}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** The board's chip shell — one shape for reach, link, mode and role chips. */
export function Chip({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const NEUTRAL_CHIP =
  "border-border-default bg-bg-tertiary text-text-secondary";
