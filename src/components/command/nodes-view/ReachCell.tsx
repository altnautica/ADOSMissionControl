"use client";

/**
 * @module command/nodes-view/ReachCell
 * @description How the GCS reaches one node, over which bearer, and what that
 * reach is worth.
 *
 * The chip is the honest answer to "how does this node get here, and if I press
 * something in this row, what carries it?" — a LAN lane is direct and returns
 * the vehicle's own acknowledgement, a cloud lane only confirms the command was
 * queued, a directly-connected board has no agent lane at all, and a drone the
 * GCS never paired with is still carried over a ground node's WFB relay rather
 * than being called unreachable. A node reached more than one way shows its
 * primary path plus a muted secondary-bearer chip.
 *
 * A WFB bearer is coloured by whether its link is actually proven: verified only
 * when the far side heard a frame from it (a received-side signal), otherwise
 * unverified / stale / down — never a confident green from a link this row
 * cannot prove (Rule 44 / Rule 37).
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import {
  CircuitBoard,
  Cloud,
  CornerDownRight,
  Radio,
  ShieldOff,
  Wifi,
  WifiOff,
} from "lucide-react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { NodeReachDescriptor } from "@/lib/nodes/node-reach";
import type { CommandAgentLiveness } from "@/lib/nodes/presence";
import {
  deriveNodeBearers,
  type BearerVerification,
  type NodeBearerChip,
  type NodeBearerKind,
} from "@/lib/nodes/node-bearer";
import { useReachedViaName } from "@/lib/nodes/reach-provenance";
import { useNodeControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { cn } from "@/lib/utils";
import { Chip, NEUTRAL_CHIP, staleClass } from "./cell-primitives";

const KIND_ICON: Record<NodeBearerKind, typeof Wifi> = {
  lan: Wifi,
  wfb: Radio,
  cloud: Cloud,
  "direct-fc": CircuitBoard,
  none: WifiOff,
};

/** Fixed chip colour for a capability bearer (LAN / cloud / direct-fc / none). */
const KIND_CLASS: Record<Exclude<NodeBearerKind, "wfb">, string> = {
  lan: "border-status-success/40 bg-status-success/10 text-status-success",
  cloud: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  "direct-fc": NEUTRAL_CHIP,
  none: "border-border-default bg-bg-tertiary text-text-tertiary",
};

/** A WFB bearer's colour follows its verification — never green unless proven. */
const WFB_CLASS: Record<BearerVerification, string> = {
  verified: "border-status-success/40 bg-status-success/10 text-status-success",
  unverified: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  stale: "border-border-default bg-bg-tertiary text-text-tertiary opacity-70",
  down: "border-border-default bg-bg-tertiary text-text-tertiary",
};

/**
 * A shape (not a colour) for each WFB verification state, appended to the chip
 * so the verdict survives greyscale and colour-blindness where WFB_CLASS alone
 * would not. Aria-hidden: the sr-only title already states the verdict in words.
 */
const WFB_MARK: Record<BearerVerification, string> = {
  verified: "✓",
  unverified: "?",
  stale: "~",
  down: "✕",
};

function chipClass(chip: NodeBearerChip): string {
  return chip.kind === "wfb"
    ? WFB_CLASS[chip.verification]
    : KIND_CLASS[chip.kind];
}

type Translate = ReturnType<typeof useTranslations>;

/** The visible label for a bearer chip. */
function chipLabel(chip: NodeBearerChip, t: Translate): string {
  if (chip.kind === "wfb") {
    return chip.viaName
      ? t("bearer.wfbVia", { node: chip.viaName })
      : t("bearer.wfb");
  }
  return t(`bearer.${chip.kind}`);
}

/** The hover / accessible explanation for the primary chip. */
function primaryTitle(
  chip: NodeBearerChip,
  reach: NodeReachDescriptor,
  t: Translate,
): string {
  if (chip.kind === "wfb") {
    if (chip.verification === "verified" && chip.rssiDbm != null) {
      return t("bearer.verified", { rssi: chip.rssiDbm });
    }
    return t(`bearer.${chip.verification}`);
  }
  if (chip.kind === "direct-fc") {
    // A connected direct FC is driven through its own live link and returns the
    // vehicle's answer; only a disconnected one has no lane to offer.
    return reach.commandable ? t("reach.directFcLive") : t("blocked.direct-fc");
  }
  if (chip.kind === "none") {
    return reach.blockedReason
      ? t(`blocked.${reach.blockedReason}`)
      : t("bearer.down");
  }
  // A working LAN / cloud lane says what its result is worth.
  return reach.reportsVehicleAck
    ? t("reach.acknowledged")
    : t("reach.queuedOnly");
}

export function ReachCell({
  node,
  reach,
  liveness,
}: {
  node: FleetNodeEntry;
  reach: NodeReachDescriptor;
  liveness: CommandAgentLiveness;
}) {
  const t = useTranslations("nodesView");
  const reachedViaName = useReachedViaName(node.reachedVia);
  // A relayed drone's WFB peer RSSI rides its funneled status row (the received-
  // side signal the ground node heard it at). A directly-paired drone carries no
  // such row, so its secondary WFB chip stays unverified by construction.
  const wfbRssiDbm = useCommandFleetStore(
    (s) => s.cloudStatuses[node.deviceId]?.peerRssiDbm ?? null,
  );
  // The bearer chips above answer the AGENT lane — service restart, config,
  // update — which the broker's write policy cannot affect. Publishing FC
  // frames is a different lane with a different answer, so it gets its own chip
  // rather than recolouring the bearer. Neither subsumes the other; a row that
  // showed one as if it were the other would over- or under-state the outage.
  const authority = useNodeControlAuthorityNotice(node._id);

  const { primary, secondary } = deriveNodeBearers({
    reachKind: reach.kind,
    isRelayed: node.isRelayed ?? false,
    hasReachedVia: !node.isRelayed && !!node.reachedVia,
    reachedViaName,
    wfbRssiDbm,
    liveness,
  });

  const PrimaryIcon = KIND_ICON[primary.kind];
  const showRssi =
    primary.kind === "wfb" &&
    primary.rssiDbm != null &&
    (primary.verification === "verified" || primary.verification === "stale");

  // The chip's verification / provenance / blocked reason lives only on a
  // `title`, which is mouse-hover-only and sits on a non-focusable span, so it
  // never reaches a keyboard or screen-reader operator. Mirror each title into a
  // visually-hidden companion span (the UnknownValue / RelayModeCell pattern) so
  // assistive tech hears the same answer the hover gives.
  const primaryTitleText = primaryTitle(primary, reach, t);
  const secondaryTitleText = secondary
    ? t("bearer.alsoVia", { node: secondary.viaName ?? t("bearer.wfb") })
    : undefined;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Chip className={chipClass(primary)} title={primaryTitleText}>
        <PrimaryIcon size={10} />
        {chipLabel(primary, t)}
        {primary.kind === "wfb" && (
          <span aria-hidden="true" className="font-mono">
            {WFB_MARK[primary.verification]}
          </span>
        )}
        <span className="sr-only">{primaryTitleText}</span>
      </Chip>
      {showRssi && (
        <span
          className={cn(
            "font-mono text-[10px] tabular-nums text-text-tertiary",
            // A stale reading is dimmed so the number never reads as a live
            // measurement (Rule 44), the same treatment the rest of the row's
            // stale cells get.
            staleClass(primary.verification === "stale" ? "stale" : "fresh"),
          )}
        >
          {primary.rssiDbm} dBm
        </span>
      )}
      {secondary && (
        <Chip className={NEUTRAL_CHIP} title={secondaryTitleText}>
          <CornerDownRight size={9} className="opacity-70" />+
          {chipLabel(secondary, t)}
          <span className="sr-only">{secondaryTitleText}</span>
        </Chip>
      )}
      {authority.show && (
        <Chip
          className={
            authority.level === "warning"
              ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
              : NEUTRAL_CHIP
          }
          title={authority.detail}
        >
          <ShieldOff size={10} />
          {authority.label}
          <span className="sr-only">{authority.detail}</span>
        </Chip>
      )}
    </span>
  );
}
