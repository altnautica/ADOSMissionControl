"use client";

/**
 * @module link-up/LinkUpPlaceholder
 * @description One reusable, context-aware empty-state for degraded surfaces.
 * Variant-driven: icon + concise headline + benefit-led subtext + one primary
 * CTA (+ optional secondary), where the CTA routes to an existing opener via
 * link-up-actions. Replaces blank, absent, or frozen panels with a guided way
 * forward.
 *
 * Accessibility: real focusable CTA buttons; state carried by icon + label, not
 * colour alone; `role="status"` so live-state variants announce.
 *
 * Icons are resolved at render time (not in a module-level map) so the file
 * stays importable under partial lucide mocks.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Lock, Plane, Unplug, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { openConnectFc, openPairNode, reconnectAgent } from "./link-up-actions";

export type LinkUpVariant =
  | "no-fc-direct"
  | "no-fc-agent"
  | "stale-pairing"
  | "pair-required"
  | "agent-offline"
  | "no-flights"
  | "loading";

type Accent = "neutral" | "error" | "warning";
type ActionKind = "connectFc" | "pairNode" | "reconnect" | "custom";

interface VariantSpec {
  accent: Accent;
  primary?: ActionKind;
  /** agent-offline: offer "pair a different node" beneath Reconnect. */
  pairFallback?: boolean;
}

const VARIANTS: Record<LinkUpVariant, VariantSpec> = {
  "no-fc-direct": { accent: "neutral", primary: "connectFc" },
  "no-fc-agent": { accent: "neutral" },
  "stale-pairing": { accent: "warning", primary: "custom" },
  "pair-required": { accent: "warning", primary: "pairNode" },
  "agent-offline": { accent: "error", primary: "reconnect", pairFallback: true },
  "no-flights": { accent: "neutral" },
  loading: { accent: "neutral" },
};

const ACCENT_CLASS: Record<Accent, string> = {
  neutral: "text-text-tertiary",
  error: "text-status-error",
  warning: "text-status-warning",
};

// Render-time icon resolution — referenced here, not at module scope, so the
// module imports cleanly under partial lucide mocks.
function variantIcon(variant: LinkUpVariant, className: string): ReactNode {
  const p = { size: 32, className } as const;
  switch (variant) {
    case "pair-required":
      return <Lock {...p} />;
    case "no-fc-direct":
    case "no-fc-agent":
    case "stale-pairing":
      return <Unplug {...p} />;
    case "agent-offline":
      return <WifiOff {...p} />;
    case "no-flights":
      return <Plane {...p} />;
    case "loading":
      return <Loader2 {...p} className={cn(className, "animate-spin")} />;
  }
}

export interface LinkUpPlaceholderProps {
  variant: LinkUpVariant;
  droneName?: string;
  /** "Xs ago" label for offline copy. */
  lastSeenLabel?: string;
  /** Handler for the "custom" primary action (e.g. re-pair a stale node). */
  onPrimary?: () => void;
  /** Override the primary CTA label (used with onPrimary). */
  primaryLabel?: string;
  /** Optional secondary destructive action (e.g. remove a stale node). When
   * provided, renders a secondary button alongside the primary CTA. */
  onSecondary?: () => void;
  /** Override the secondary button label (defaults to the remove-node copy). */
  secondaryLabel?: string;
  /** Override the "pair a companion computer" action. Dashboard surfaces pass
   * a router navigation to /command; command surfaces let it open the dialog. */
  onPairNode?: () => void;
  className?: string;
}

export function LinkUpPlaceholder({
  variant,
  droneName,
  lastSeenLabel,
  onPrimary,
  primaryLabel,
  onSecondary,
  secondaryLabel,
  onPairNode,
  className,
}: LinkUpPlaceholderProps) {
  const t = useTranslations("linkUp");
  const spec = VARIANTS[variant];

  const pair = onPairNode ?? openPairNode;

  const values: Record<string, string> = {
    name: droneName ?? "",
    ago: lastSeenLabel ?? "",
  };
  const title = t(`${variant}.title`, values);
  const body = t(`${variant}.body`, values);

  function runAction(kind: ActionKind | undefined) {
    if (!kind) return;
    if (kind === "connectFc") return openConnectFc();
    if (kind === "pairNode") return pair();
    if (kind === "custom") return onPrimary?.();
    if (kind === "reconnect") {
      const ok = reconnectAgent();
      if (!ok) pair();
    }
  }

  function ctaLabel(kind: ActionKind): string {
    if (kind === "custom") return primaryLabel ?? t("cta.rePair");
    if (variant === "pair-required") return t("pair-required.cta");
    return t(`cta.${kind}`);
  }

  const isLive = variant === "loading" || variant === "agent-offline";

  return (
    <div
      role={isLive ? "status" : undefined}
      aria-live={isLive ? "polite" : undefined}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center",
        className,
      )}
    >
      {variantIcon(variant, ACCENT_CLASS[spec.accent])}
      <div className="max-w-sm">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 text-xs text-text-secondary leading-relaxed">{body}</p>
      </div>

      {(spec.primary || onSecondary) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {spec.primary && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => runAction(spec.primary)}
            >
              {ctaLabel(spec.primary)}
            </Button>
          )}
          {onSecondary && (
            <Button variant="secondary" size="sm" onClick={onSecondary}>
              {secondaryLabel ?? t("cta.removeNode")}
            </Button>
          )}
        </div>
      )}

      {spec.pairFallback && (
        <button
          type="button"
          onClick={pair}
          className="text-[11px] text-text-tertiary underline-offset-2 hover:underline"
        >
          {t("cta.pairDifferent")}
        </button>
      )}
    </div>
  );
}
