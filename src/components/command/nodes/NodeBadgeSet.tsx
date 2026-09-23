"use client";

/**
 * @module nodes/NodeBadgeSet
 * @description Per-profile ordered badge candidates for a sidebar node row,
 * ranked by decreasing operator urgency (safety/liveness -> role -> workload ->
 * identity). The top N survive on the row; the rest collapse to a `+N` chip.
 * An offline node shows a single liveness badge and nothing else. A stale node
 * leads with a Stale badge followed only by identity badges (firmware, role,
 * tier, hardware composition in a neutral tone); no badge asserts a live link
 * the GCS has not heard recently (a stale node never shows a fresh-looking `0`
 * or a green FC).
 *
 * The sidebar only carries the verified fields on the merged node entry
 * (liveness, role, tier, fc-linked); live per-node telemetry (arm/RSSI/CPU/jobs)
 * belongs to the selected node's stores and is intentionally NOT fabricated here.
 * @license GPL-3.0-only
 */

import { Cpu } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { groundRoleKey, type EffProfile } from "@/lib/nodes/node-profile";
import { Badge } from "@/components/ui/badge";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { droneLiveness } from "../fleet/types";
import { isFcReachable } from "@/lib/agent/mavlink-link";
import { fcFlavorLabel } from "@/lib/protocol/fc-firmware-label";

type BadgeVariant = "success" | "warning" | "serious" | "error" | "info" | "neutral";

interface NodeBadge {
  key: string;
  label: string;
  variant: BadgeVariant;
  /** When set, a redundant StatusDot renders before the label (liveness). */
  dot?: StatusLevel;
  /** Companion marker: the drone carries an onboard computer. */
  companion?: boolean;
}

/**
 * The resolved `nodeConsole.*` strings `nodeBadges` needs. Passed in rather than
 * read from a hook so the function stays pure and unit-testable.
 */
export interface NodeBadgeLabels {
  offline: string;
  stale: string;
  relay: string;
  receiver: string;
  direct: string;
  roleUnknown: string;
  compute: string;
  fc: string;
  companion: string;
}

/** Resolve the badge labels from a `nodeConsole` translator. */
export function nodeBadgeLabels(t: (key: string) => string): NodeBadgeLabels {
  return {
    offline: t("liveness.offline"),
    stale: t("liveness.stale"),
    relay: t("role.relay"),
    receiver: t("role.receiver"),
    direct: t("role.direct"),
    roleUnknown: t("role.unknown"),
    compute: t("badge.compute"),
    fc: t("badge.fc"),
    companion: t("badge.companion"),
  };
}

/**
 * The ordered candidate badge list for a node, honest to the fields the sidebar
 * actually has. Offline short-circuits to a single liveness badge; stale drops
 * every live-link badge.
 */
export function nodeBadges(
  node: FleetNodeEntry,
  effProfile: EffProfile,
  labels: NodeBadgeLabels,
): NodeBadge[] {
  const live = droneLiveness(node);
  if (live === "offline") {
    // Single liveness badge, no sub-metrics.
    return [{ key: "offline", label: labels.offline, variant: "neutral", dot: "offline" }];
  }

  const badges: NodeBadge[] = [];
  if (live === "stale") {
    // Stale wins the top slot; live sub-metrics are unverifiable.
    badges.push({ key: "stale", label: labels.stale, variant: "serious", dot: "serious" });
  }

  switch (effProfile) {
    case "ground-station": {
      // role -> identity. Only a reported, known role earns a role label; an
      // unset or not-yet-reported role reads as unknown, never as "Direct".
      const role = groundRoleKey(node.role);
      badges.push({
        key: "role",
        label: role === "unknown" ? labels.roleUnknown : labels[role],
        variant: role === "relay" || role === "receiver" ? "info" : "neutral",
      });
      if (node.tier != null) {
        badges.push({ key: "tier", label: `T${node.tier}`, variant: "neutral" });
      }
      break;
    }
    case "workstation": {
      // A workstation carries no flight metrics by construction, and the
      // sidebar has no per-node cluster state, so it shows identity only.
      badges.push({ key: "type", label: labels.compute, variant: "info" });
      if (node.tier != null) {
        badges.push({ key: "tier", label: `T${node.tier}`, variant: "neutral" });
      }
      break;
    }
    case "flight-controller": {
      const flavor = fcFlavorLabel(node.fcFirmware, node.fcVariant, node.frameType);
      if (flavor) badges.push({ key: "flavor", label: flavor, variant: "info" });
      badges.push({ key: "fc", label: labels.fc, variant: "info" });
      if (node.tier != null) {
        badges.push({ key: "tier", label: `T${node.tier}`, variant: "neutral" });
      }
      break;
    }
    case "drone":
    default: {
      const flavor = fcFlavorLabel(node.fcFirmware, node.fcVariant, node.frameType);
      if (flavor) badges.push({ key: "flavor", label: flavor, variant: "info" });
      const fcReachable = isFcReachable({
        fcConnected: node.fcConnected,
        fcVariant: node.fcVariant,
        transportOpen: node.transportOpen,
      });
      if (node.board) {
        // A companion drone's FC folds into the combined "FC + SBC" badge. Its
        // tone follows the FC link: neutral while the node is stale (the FC
        // state is unverifiable), warning when the FC is not reachable.
        badges.push({
          key: "companion",
          label: labels.companion,
          variant: live === "stale" ? "neutral" : fcReachable ? "success" : "warning",
          companion: true,
        });
      } else if (fcReachable && live !== "stale") {
        // FC-only drones show a plain "FC" badge (for a connected MAVLink FC or
        // a reachable MSP FC, which never sets fcConnected). The link state is
        // last-known on a stale node, so it is not shown there.
        badges.push({ key: "fc", label: labels.fc, variant: "success" });
      }
      break;
    }
  }

  return badges;
}

interface NodeBadgeSetProps {
  node: FleetNodeEntry;
  effProfile: EffProfile;
  /** Top-N shown on the row (2 expanded, 1 mini); the rest become a `+N` chip. */
  max: number;
  className?: string;
}

export function NodeBadgeSet({
  node,
  effProfile,
  max,
  className,
}: NodeBadgeSetProps) {
  const t = useTranslations("nodeConsole");
  const base = nodeBadges(node, effProfile, nodeBadgeLabels(t));
  // A relayed-only node (reached solely through a ground node over WFB) leads
  // with a "Relayed" badge so it reads distinctly from a directly-paired node.
  // Suppressed when offline/stale so a dead node never shows a fresh sub-metric
  // (the liveness badge stands alone there).
  const badges =
    node.isRelayed && droneLiveness(node) === "live"
      ? [
          {
            key: "relayed",
            label: t("provenance.relayed"),
            variant: "info" as const,
          },
          ...base,
        ]
      : base;
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  const overflow = badges.length - shown.length;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {shown.map((b) => (
        <Badge
          key={b.key}
          variant={b.variant}
          className="gap-1 rounded normal-case tracking-normal"
        >
          {b.dot && <StatusDot status={b.dot} size="xs" label={b.label} />}
          {b.companion && <Cpu size={9} aria-hidden />}
          {b.label}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="neutral" className="rounded normal-case tracking-normal">
          +{overflow}
        </Badge>
      )}
    </div>
  );
}
