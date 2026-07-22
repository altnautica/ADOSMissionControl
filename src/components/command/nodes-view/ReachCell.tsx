"use client";

/**
 * @module command/nodes-view/ReachCell
 * @description How the GCS reaches one node, and what that reach is worth.
 *
 * The chip is the honest answer to "if I press something in this row, what
 * carries it?" — a LAN lane returns the vehicle's own acknowledgement, a cloud
 * lane only confirms the command was queued, a directly-connected board has no
 * agent lane at all, and an unreachable node names which of the four causes it
 * is so the operator knows what to fix.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { CircuitBoard, Cloud, Wifi, WifiOff } from "lucide-react";

import type { NodeReachDescriptor, NodeReachKind } from "@/lib/nodes/node-reach";
import { Chip, NEUTRAL_CHIP } from "./cell-primitives";

const KIND_ICON: Record<NodeReachKind, typeof Wifi> = {
  lan: Wifi,
  cloud: Cloud,
  "direct-fc": CircuitBoard,
  none: WifiOff,
};

const KIND_CLASS: Record<NodeReachKind, string> = {
  lan: "border-status-success/40 bg-status-success/10 text-status-success",
  cloud: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  "direct-fc": NEUTRAL_CHIP,
  none: "border-border-default bg-bg-tertiary text-text-tertiary",
};

export function ReachCell({ reach }: { reach: NodeReachDescriptor }) {
  const t = useTranslations("nodesView");
  const Icon = KIND_ICON[reach.kind];

  // A blocked reach explains itself; a working one says what its result means.
  const title = reach.blockedReason
    ? t(`blocked.${reach.blockedReason}`)
    : reach.reportsVehicleAck
      ? t("reach.acknowledged")
      : t("reach.queuedOnly");

  return (
    <Chip className={KIND_CLASS[reach.kind]} title={title}>
      <Icon size={10} />
      {t(`reach.${reach.kind}`)}
    </Chip>
  );
}
