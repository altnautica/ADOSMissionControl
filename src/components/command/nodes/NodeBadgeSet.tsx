"use client";

/**
 * @module nodes/NodeBadgeSet
 * @description Per-profile ordered badge candidates for a sidebar node row,
 * ranked by decreasing operator urgency (safety/liveness -> role -> workload ->
 * identity). The top N survive on the row; the rest collapse to a `+N` chip.
 * When the node is offline/stale, every sub-metric badge is replaced by a single
 * liveness badge (Rule 44 — a stale node never shows a fresh-looking `0`).
 *
 * The sidebar only carries the verified fields on the merged node entry
 * (liveness, role, tier, fc-linked); live per-node telemetry (arm/RSSI/CPU/jobs)
 * belongs to the selected node's stores and is intentionally NOT fabricated here.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { EffProfile } from "@/lib/nodes/node-profile";
import { Badge } from "@/components/ui/badge";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { droneLiveness } from "../fleet/types";
import { isFcReachable } from "@/lib/agent/mavlink-link";

type BadgeVariant = "success" | "warning" | "serious" | "error" | "info" | "neutral";

interface NodeBadge {
  key: string;
  label: string;
  variant: BadgeVariant;
  /** When set, a redundant StatusDot renders before the label (liveness). */
  dot?: StatusLevel;
}

/** The firmware · airframe flavor label for a drone / FC row (e.g. "ArduPilot ·
 * VTOL", "PX4", "Betaflight · FPV"), or null when the firmware is unknown. This
 * is the badge that distinguishes the firmware flavors at a glance. */
function flavorLabel(node: FleetNodeEntry): string | null {
  const fw = node.fcFirmware;
  if (!fw || fw === "unknown") return null;
  const name =
    fw === "ardupilot"
      ? "ArduPilot"
      : fw === "px4"
        ? "PX4"
        : fw === "betaflight"
          ? "Betaflight"
          : fw === "inav"
            ? "iNav"
            : fw;
  return node.frameType ? `${name} · ${node.frameType}` : name;
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
  compute: string;
  fc: string;
}

/** Resolve the badge labels from a `nodeConsole` translator. */
export function nodeBadgeLabels(t: (key: string) => string): NodeBadgeLabels {
  return {
    offline: t("liveness.offline"),
    stale: t("liveness.stale"),
    relay: t("role.relay"),
    receiver: t("role.receiver"),
    direct: t("role.direct"),
    compute: t("badge.compute"),
    fc: t("badge.fc"),
  };
}

/**
 * The ordered candidate badge list for a node, honest to the fields the sidebar
 * actually has. Offline/stale short-circuits to a single liveness badge.
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
      // role -> identity
      if (node.role && node.role !== "direct") {
        badges.push({
          key: "role",
          label: node.role === "relay" ? labels.relay : labels.receiver,
          variant: "info",
        });
      } else {
        badges.push({ key: "role", label: labels.direct, variant: "neutral" });
      }
      if (node.tier != null) {
        badges.push({ key: "tier", label: `T${node.tier}`, variant: "neutral" });
      }
      break;
    }
    case "workstation": {
      // A workstation carries no flight metrics by construction — identity only
      // until live cluster state is wired per-node (P8/P9).
      badges.push({ key: "type", label: labels.compute, variant: "info" });
      if (node.tier != null) {
        badges.push({ key: "tier", label: `T${node.tier}`, variant: "neutral" });
      }
      break;
    }
    case "flight-controller": {
      const flavor = flavorLabel(node);
      if (flavor) badges.push({ key: "flavor", label: flavor, variant: "info" });
      badges.push({ key: "fc", label: labels.fc, variant: "info" });
      if (node.tier != null) {
        badges.push({ key: "tier", label: `T${node.tier}`, variant: "neutral" });
      }
      break;
    }
    case "drone":
    default: {
      const flavor = flavorLabel(node);
      if (flavor) badges.push({ key: "flavor", label: flavor, variant: "info" });
      // FC-only drones show a plain "FC" badge (for a connected MAVLink FC or a
      // reachable MSP FC, which never sets fcConnected). A companion drone's FC
      // is folded into the combined "FC + SBC" badge (with a hover summary)
      // rendered in NodeRow, so skip the standalone FC when the drone has an SBC.
      if (
        !node.board &&
        isFcReachable({
          fcConnected: node.fcConnected,
          fcVariant: node.fcVariant,
          transportOpen: node.transportOpen,
        })
      ) {
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
  // (Rule 44 — the liveness badge stands alone there).
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
