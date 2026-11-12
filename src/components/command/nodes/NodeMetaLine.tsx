"use client";

/**
 * @module nodes/NodeMetaLine
 * @description The sidebar row's second line, on one line and never wrapping:
 * a quiet text summary (stale/offline first, then the operator badge, the
 * firmware / role / type and the tier) followed by a fixed cluster of small
 * icons for the node's hardware, reach and command authority, and a drone's
 * battery when it is live. Every icon carries the same label the old badges
 * printed, as its accessible name and tooltip.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  BatteryMedium,
  CircuitBoard,
  Cpu,
  RadioTower,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { EffProfile } from "@/lib/nodes/node-profile";
import { StatusDot } from "@/components/ui/status-dot";
import { resolveFeatureDot } from "@/lib/nodes/node-feature-dots";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useNodeControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { droneLiveness } from "../fleet/types";
import { nodeBadgeLabels, nodeBadgesWithProvenance, type NodeBadge } from "./NodeBadgeSet";

/** Icon tone per badge variant: colour only where it asks for attention. */
const ICON_TONE: Record<NodeBadge["variant"], string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  serious: "text-status-serious",
  error: "text-status-error",
  info: "text-text-tertiary",
  neutral: "text-text-tertiary",
};

/** Badge keys that read as text on the line, in this order. */
const TEXT_KEYS = ["flavor", "role", "type", "tier"] as const;

function MetaIcon({
  label,
  title,
  className,
  children,
}: {
  label: string;
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <span role="img" aria-label={label} title={title} className={cn("flex shrink-0", className)}>
      {children}
    </span>
  );
}

export function NodeMetaLine({
  node,
  effProfile,
}: {
  node: FleetNodeEntry;
  effProfile: EffProfile;
}) {
  const t = useTranslations("nodeConsole");
  const personalization = useNodePersonalizationStore((s) => s.byNode[node.deviceId]);
  const authority = useNodeControlAuthorityNotice(node._id);
  const liveness = droneLiveness(node);
  const battery = useCommandFleetStore((s) =>
    effProfile === "drone" && liveness === "live"
      ? s.cloudStatuses[node.deviceId]?.telemetry?.battery?.remaining
      : undefined,
  );

  const badges = nodeBadgesWithProvenance(node, effProfile, nodeBadgeLabels(t));
  const byKey = (key: string) => badges.find((b) => b.key === key);
  const leading = byKey("stale") ?? byKey("offline");
  const text = [
    personalization?.badge,
    ...TEXT_KEYS.map((k) => byKey(k)?.label),
  ].filter((s): s is string => Boolean(s));
  const companion = byKey("companion");
  const fc = byKey("fc");
  const relayed = byKey("relayed");
  const featureDots = (personalization?.dots ?? []).slice(0, 4);

  return (
    <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
      <span className="min-w-0 flex-1 truncate text-[11px] text-text-tertiary">
        {leading && (
          <span
            className={leading.key === "stale" ? "text-status-serious" : "text-text-tertiary"}
          >
            {leading.label}
            {text.length > 0 && " · "}
          </span>
        )}
        {text.join(" · ")}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {featureDots.length > 0 && (
          <span className="flex items-center gap-0.5" aria-label={t("signalDots")}>
            {featureDots.map((dot) => {
              const resolved = resolveFeatureDot(dot.signal, node);
              return (
                <StatusDot
                  key={dot.signal}
                  status={resolved.level}
                  shape={resolved.known ? "dot" : "ring"}
                  size="xs"
                  label={t("signalTooltip", {
                    signal: t(resolved.labelKey),
                    state: t(resolved.stateKey),
                  })}
                />
              );
            })}
          </span>
        )}
        {companion && (
          <MetaIcon label={companion.label} title={companion.label} className={ICON_TONE[companion.variant]}>
            <Cpu size={12} aria-hidden />
          </MetaIcon>
        )}
        {fc && (
          <MetaIcon label={fc.label} title={fc.label} className={ICON_TONE[fc.variant]}>
            <CircuitBoard size={12} aria-hidden />
          </MetaIcon>
        )}
        {relayed && (
          <MetaIcon label={relayed.label} title={relayed.label} className="text-accent-primary">
            <RadioTower size={12} aria-hidden />
          </MetaIcon>
        )}
        {node.isLocal && liveness !== "offline" && (
          <MetaIcon label={t("badge.lan")} title={t("badge.lan")} className="text-text-tertiary">
            <Wifi size={12} aria-hidden />
          </MetaIcon>
        )}
        {authority.show && (
          <MetaIcon
            label={authority.label}
            title={authority.detail}
            className={authority.level === "warning" ? "text-status-warning" : "text-text-tertiary"}
          >
            <ShieldAlert size={12} aria-hidden />
          </MetaIcon>
        )}
        {typeof battery === "number" && (
          <span
            data-testid="node-meta-battery"
            className={cn(
              "flex items-center gap-0.5 tabular-nums text-[11px]",
              battery < 15
                ? "text-status-error"
                : battery < 30
                  ? "text-status-warning"
                  : "text-text-tertiary",
            )}
          >
            <BatteryMedium size={12} aria-hidden />
            {Math.round(battery)}%
          </span>
        )}
      </span>
    </div>
  );
}
