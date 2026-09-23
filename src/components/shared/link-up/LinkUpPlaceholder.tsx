"use client";

/**
 * @module link-up/LinkUpPlaceholder
 * @description One reusable, context-aware empty-state for every degraded
 * surface in the app. Variant-driven: icon + concise headline + benefit-led
 * subtext + one primary CTA (+ optional secondary / value-prop list / install
 * disclosure), where the CTA routes to an existing opener via link-up-actions.
 * Replaces blank, absent, or frozen panels with a guided way forward.
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
import {
  AlertTriangle,
  CameraOff,
  Cpu,
  Loader2,
  Lock,
  Plane,
  Plug,
  RadioTower,
  Signal,
  Unplug,
  Usb,
  Video,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InstallAgentStrip } from "@/components/command/disconnected/InstallAgentStrip";
import { LOCKED_VALUE_PROP_IDS } from "./locked-surfaces";
import {
  openConnectFc,
  openPairNode,
  reconnectAgent,
} from "./link-up-actions";

export type LinkUpVariant =
  | "no-connection"
  | "locked"
  | "no-fc-direct"
  | "no-fc-agent"
  | "fc-unverified"
  | "stale-pairing"
  | "pair-required"
  | "agent-offline"
  | "agent-stale"
  | "no-camera"
  | "no-npu"
  | "no-radio"
  | "no-peripherals"
  | "no-flights"
  | "loading";

type Accent = "neutral" | "error" | "warning";
type ActionKind = "connectFc" | "pairNode" | "reconnect" | "custom";

interface VariantSpec {
  accent: Accent;
  primary?: ActionKind;
  /** no-connection shows a second CTA next to the first. */
  secondaryCta?: ActionKind;
  /** locked: list the rest of the agent value props under the buttons. */
  showValueProps?: boolean;
  /** locked: embed the install one-liner disclosure. */
  showInstall?: boolean;
  /** agent-offline: offer "pair a different node" beneath Reconnect. */
  pairFallback?: boolean;
  /** no-connection: show the disambiguation line. */
  showZeroStateExtras?: boolean;
}

const VARIANTS: Record<LinkUpVariant, VariantSpec> = {
  "no-connection": {
    accent: "neutral",
    primary: "connectFc",
    secondaryCta: "pairNode",
    showZeroStateExtras: true,
  },
  locked: {
    accent: "neutral",
    primary: "pairNode",
    showValueProps: true,
    showInstall: true,
  },
  "no-fc-direct": { accent: "neutral", primary: "connectFc" },
  "no-fc-agent": { accent: "neutral" },
  "fc-unverified": { accent: "warning" },
  "stale-pairing": { accent: "warning", primary: "custom" },
  "pair-required": { accent: "warning", primary: "pairNode" },
  "agent-offline": { accent: "error", primary: "reconnect", pairFallback: true },
  "agent-stale": { accent: "warning", primary: "reconnect" },
  "no-camera": { accent: "neutral", primary: "custom" },
  "no-npu": { accent: "neutral" },
  "no-radio": { accent: "neutral" },
  "no-peripherals": { accent: "neutral", primary: "custom" },
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
    case "no-connection":
      return <Plug {...p} />;
    case "locked":
    case "pair-required":
      return <Lock {...p} />;
    case "no-fc-direct":
    case "no-fc-agent":
    case "stale-pairing":
      return <Unplug {...p} />;
    case "fc-unverified":
    case "agent-stale":
      return <AlertTriangle {...p} />;
    case "agent-offline":
      return <WifiOff {...p} />;
    case "no-camera":
      return <CameraOff {...p} />;
    case "no-npu":
      return <Cpu {...p} />;
    case "no-radio":
      return <RadioTower {...p} />;
    case "no-peripherals":
      return <Usb {...p} />;
    case "no-flights":
      return <Plane {...p} />;
    case "loading":
      return <Loader2 {...p} className={cn(className, "animate-spin")} />;
  }
}

function valuePropIcon(id: string): ReactNode {
  const p = { size: 12 } as const;
  switch (id) {
    case "video":
      return <Video {...p} />;
    case "system":
      return <Cpu {...p} />;
    case "peripherals":
      return <Usb {...p} />;
    case "radio":
      return <RadioTower {...p} />;
    case "cellular":
      return <Signal {...p} />;
    default:
      return null;
  }
}

export interface LinkUpPlaceholderProps {
  variant: LinkUpVariant;
  /** Localised surface name for the "locked" headline (e.g. "HD video"). */
  surface?: string;
  droneName?: string;
  /** "Xs ago" label for offline/stale copy. */
  lastSeenLabel?: string;
  fcPort?: string;
  fcBaud?: number;
  /** Handler for the "custom" primary action (e.g. peripherals rescan). */
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
  surface,
  droneName,
  lastSeenLabel,
  fcPort,
  fcBaud,
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

  const values: Record<string, string | number> = {
    surface: surface ?? "",
    name: droneName ?? "",
    ago: lastSeenLabel ?? "",
    port: fcPort ?? "",
    baud: fcBaud ?? "",
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
    if (kind === "custom") {
      if (primaryLabel) return primaryLabel;
      if (variant === "stale-pairing") return t("cta.rePair");
      return t("cta.retry");
    }
    if (variant === "pair-required") return t("pair-required.cta");
    return t(`cta.${kind}`);
  }

  const isLive =
    variant === "loading" ||
    variant === "agent-offline" ||
    variant === "agent-stale";

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

      {spec.showValueProps && (
        <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 max-w-sm">
          {LOCKED_VALUE_PROP_IDS.map((id) => (
            <li
              key={id}
              className="inline-flex items-center gap-1 text-[11px] text-text-tertiary"
            >
              {valuePropIcon(id)}
              {t(`surface.${id}`)}
            </li>
          ))}
        </ul>
      )}

      {(spec.primary || spec.secondaryCta || onSecondary) && (
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
          {spec.secondaryCta && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => runAction(spec.secondaryCta)}
            >
              {ctaLabel(spec.secondaryCta)}
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

      {spec.showZeroStateExtras && (
        <p className="mt-1 max-w-md text-[11px] text-text-tertiary leading-relaxed">
          {t("disambiguation")}
        </p>
      )}

      {spec.showInstall && (
        <div className="mt-2 w-full max-w-md">
          <InstallAgentStrip />
        </div>
      )}
    </div>
  );
}
