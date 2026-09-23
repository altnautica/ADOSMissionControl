"use client";

/**
 * @module components/command/SigningStatusBadge
 * @description MAVLink signing state pill for a drone.
 *
 * Five variants, each with a distinct icon, color, and aria-label so the
 * state is legible to both sighted users and screen readers:
 *
 *   Signed              — browser key present, FC enrolled
 *   Unconfirmed         — an enrollment or disable the FC never acknowledged;
 *                         the operator has to settle which key it holds
 *   Unsigned            — firmware supports signing but no browser key
 *   Not available       — firmware does not expose a signing key store
 *
 * There is deliberately no "mismatch" variant. One existed, driven by a
 * `rxInvalidCount` that nothing ever incremented, because the receive path
 * performs no HMAC verification — the parser only observes that a frame
 * carried the signed bit. The variant was therefore unreachable in
 * production while its unit test passed by injecting the counter directly,
 * and an operator on a genuinely stale key saw a green "Signed" pill. A
 * mismatch badge belongs here only once something real can detect one.
 *
 * @license GPL-3.0-only
 */

import { Lock, Unlock, MinusCircle, ShieldAlert, type LucideIcon } from "lucide-react";
import { useSigningStore } from "@/stores/signing-store";

interface Props {
  droneId: string;
  /** Hide the text label and only show the icon. */
  compact?: boolean;
}

export type SigningBadgeVariant =
  | "signed"
  | "unconfirmed"
  | "unsigned"
  | "na"
  | "loading";

export interface BadgeClassifyInput {
  capability: { supported: boolean } | null;
  hasBrowserKey: boolean;
  enrollmentState?: string;
}

export function SigningStatusBadge({ droneId, compact = false }: Props) {
  const state = useSigningStore((s) => s.drones[droneId]);
  const variant = classifyVariant(state);
  const config = VARIANTS[variant];

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium ${config.className}`}
      role="status"
      aria-label={config.ariaLabel}
      title={config.tooltip}
    >
      <config.Icon size={11} aria-hidden="true" />
      {!compact && <span>{config.label}</span>}
    </span>
  );
}

/**
 * Pure variant classifier. Exported so unit tests can drive every branch
 * without mounting React.
 */
export function classifyVariant(
  state: BadgeClassifyInput | undefined,
): SigningBadgeVariant {
  if (!state || state.capability === null) return "loading";
  if (!state.capability.supported) return "na";
  if (!state.hasBrowserKey) return "unsigned";
  if (state.enrollmentState === "enrolled") return "signed";
  if (state.enrollmentState === "unconfirmed" || state.enrollmentState === "disable_unconfirmed") {
    return "unconfirmed";
  }
  return "unsigned";
}

interface VariantConfig {
  label: string;
  ariaLabel: string;
  tooltip: string;
  className: string;
  Icon: LucideIcon;
}

export const VARIANTS: Record<SigningBadgeVariant, VariantConfig> = {
  signed: {
    label: "Signed",
    ariaLabel: "MAVLink signing enabled",
    tooltip: "Every command to this drone is signed with HMAC-SHA256.",
    className: "text-status-success",
    Icon: Lock,
  },
  unconfirmed: {
    label: "Unconfirmed",
    ariaLabel: "MAVLink signing state unconfirmed",
    tooltip:
      "A key change was sent that the flight controller never acknowledged. Open the signing panel to confirm which key it holds.",
    className: "text-status-warning",
    Icon: ShieldAlert,
  },
  unsigned: {
    label: "Unsigned",
    ariaLabel: "MAVLink signing supported but not enabled",
    tooltip: "This drone supports MAVLink signing but it is not enabled.",
    className: "text-text-tertiary",
    Icon: Unlock,
  },
  na: {
    label: "No signing",
    ariaLabel: "MAVLink signing not supported on this firmware",
    tooltip: "This firmware does not expose a signing key store.",
    className: "text-text-tertiary opacity-70",
    Icon: MinusCircle,
  },
  loading: {
    label: "…",
    ariaLabel: "MAVLink signing state loading",
    tooltip: "Checking signing capability…",
    className: "text-text-tertiary opacity-50",
    Icon: Unlock,
  },
};
